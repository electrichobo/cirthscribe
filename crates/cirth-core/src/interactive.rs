//! Interactive branching storytelling and graph analysis (M6 step 4, ROADMAP M6).
//!
//! Provides passage and choice extraction, inline syntax parsing (`[[Label -> Target]]`),
//! graph integrity validation (dangling targets, dead-ends, unreachable nodes), and
//! specialized exports in Twine/Twee 3 format, standalone playable offline HTML, and JSON.

use crate::model::{new_id, Block, BlockKind, Id};
use serde::{Deserialize, Serialize};
use std::collections::{HashSet, VecDeque};

/// A branching choice pointing from one passage to a target passage.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct InteractiveChoice {
    pub id: Id,
    pub label: String,
    pub target: String,
    pub condition: Option<String>,
    pub source_block_id: Id,
}

/// An interactive story passage representing a node in the branching narrative graph.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct InteractivePassage {
    pub id: Id,
    pub title: String,
    pub tags: Vec<String>,
    pub content: String,
    pub choices: Vec<InteractiveChoice>,
    pub is_start: bool,
    pub is_ending: bool,
    pub word_count: usize,
    pub block_ids: Vec<Id>,
}

/// Classification of graph integrity issues.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GraphIssueKind {
    /// Choice points to a target passage that does not exist in the story.
    DanglingTarget,
    /// Passage has no outgoing choices and is not marked as an intentional ending.
    DeadEnd,
    /// Passage cannot be reached by traversing choices from the starting passage.
    Unreachable,
}

/// An individual issue found by the graph integrity validator.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GraphIssue {
    pub kind: GraphIssueKind,
    pub passage_id: Id,
    pub passage_title: String,
    pub message: String,
    pub choice_label: Option<String>,
    pub target: Option<String>,
}

/// Comprehensive graph integrity validation report.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GraphValidation {
    pub is_valid: bool,
    pub issues: Vec<GraphIssue>,
    pub dangling_count: usize,
    pub dead_end_count: usize,
    pub unreachable_count: usize,
}

/// Full interactive narrative graph with metadata, passages, and validation.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct InteractiveGraph {
    pub story_title: String,
    pub ifid: String,
    pub start_passage_id: String,
    pub passages: Vec<InteractivePassage>,
    pub total_passages: usize,
    pub total_choices: usize,
    pub total_endings: usize,
    pub total_words: usize,
    pub validation: GraphValidation,
}

/// Clean an alphanumeric slug for identifier matching.
pub fn slugify(s: &str) -> String {
    s.trim()
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '_' || *c == '-')
        .collect()
}

/// Parse the inner content of a `[[ ... ]]` choice link.
///
/// Supports:
/// - `[[Target]]` -> (Target, Target, None)
/// - `[[Label -> Target]]` -> (Label, Target, None)
/// - `[[Label|Target]]` -> (Label, Target, None)
/// - `[[Target <- Label]]` -> (Label, Target, None)
/// - `[[Label -> Target [if condition]]]` -> (Label, Target, Some(condition))
pub fn parse_choice_inner(raw: &str) -> (String, String, Option<String>) {
    let mut text = raw.trim();
    let mut condition: Option<String> = None;

    // Check for condition inside brackets, e.g. [if has_key] or [has_key]
    if let Some(cond_start) = text.find('[') {
        if let Some(cond_end) = text[cond_start + 1..].find(']') {
            let cond_raw = &text[cond_start + 1..cond_start + 1 + cond_end].trim();
            let cond_clean = if cond_raw.to_ascii_lowercase().starts_with("if ") {
                cond_raw[3..].trim()
            } else {
                cond_raw
            };
            if !cond_clean.is_empty() {
                condition = Some(cond_clean.to_string());
            }
            text = text[..cond_start].trim();
        }
    }

    let (label, target) = if let Some((left, right)) = text.split_once("->") {
        (left.trim(), right.trim())
    } else if let Some((left, right)) = text.split_once("<-") {
        (right.trim(), left.trim())
    } else if let Some((left, right)) = text.split_once('|') {
        (left.trim(), right.trim())
    } else {
        (text.trim(), text.trim())
    };

    let final_label = if label.is_empty() { target } else { label };
    let final_target = if target.is_empty() { label } else { target };

    (final_label.to_string(), final_target.to_string(), condition)
}

/// Extract all `[[ ... ]]` choice definitions from block text.
pub fn extract_choices(text: &str, source_block_id: &Id) -> Vec<InteractiveChoice> {
    let mut choices = Vec::new();
    let chars: Vec<char> = text.chars().collect();
    let mut i = 0;

    while i < chars.len() {
        if i + 1 < chars.len() && chars[i] == '[' && chars[i + 1] == '[' {
            let start = i + 2;
            let mut j = start;
            let mut inner_bracket_depth = 0;
            let mut found_end = None;

            while j < chars.len() {
                if chars[j] == '[' {
                    inner_bracket_depth += 1;
                    j += 1;
                } else if chars[j] == ']' {
                    if inner_bracket_depth > 0 {
                        inner_bracket_depth -= 1;
                        j += 1;
                    } else if j + 1 < chars.len() && chars[j + 1] == ']' {
                        found_end = Some(j);
                        break;
                    } else {
                        j += 1;
                    }
                } else {
                    j += 1;
                }
            }

            if let Some(end) = found_end {
                let inner: String = chars[start..end].iter().collect();
                let mut rest_idx = end + 2;

                // Check for immediate trailing condition, e.g. " (requires key)" or " {has_key}"
                let mut condition: Option<String> = None;
                while rest_idx < chars.len() && chars[rest_idx].is_whitespace() {
                    rest_idx += 1;
                }
                if rest_idx < chars.len() && chars[rest_idx] == '(' {
                    let c_start = rest_idx + 1;
                    if let Some(c_end_offset) = chars[c_start..].iter().position(|&c| c == ')') {
                        let cond_raw: String = chars[c_start..c_start + c_end_offset].iter().collect();
                        let clean = cond_raw.trim();
                        if !clean.is_empty() {
                            let cond_text = if clean.to_ascii_lowercase().starts_with("if:") {
                                clean[3..].trim()
                            } else if clean.to_ascii_lowercase().starts_with("if ") {
                                clean[3..].trim()
                            } else {
                                clean
                            };
                            condition = Some(cond_text.to_string());
                        }
                        rest_idx = c_start + c_end_offset + 1;
                    }
                } else if rest_idx < chars.len() && chars[rest_idx] == '{' {
                    let c_start = rest_idx + 1;
                    if let Some(c_end_offset) = chars[c_start..].iter().position(|&c| c == '}') {
                        let cond_raw: String = chars[c_start..c_start + c_end_offset].iter().collect();
                        let clean = cond_raw.trim();
                        if !clean.is_empty() {
                            condition = Some(clean.to_string());
                        }
                        rest_idx = c_start + c_end_offset + 1;
                    }
                }

                let (label, target, inner_cond) = parse_choice_inner(&inner);
                let final_cond = condition.or(inner_cond);

                if !label.is_empty() && !target.is_empty() {
                    choices.push(InteractiveChoice {
                        id: new_id(),
                        label,
                        target,
                        condition: final_cond,
                        source_block_id: source_block_id.clone(),
                    });
                }

                i = rest_idx;
            } else {
                i += 2;
            }
        } else {
            i += 1;
        }
    }

    choices
}

/// Check if block text marks an intentional story ending.
fn is_ending_text(text: &str) -> bool {
    let upper = text.trim().to_ascii_uppercase();
    upper == "[THE END]"
        || upper == "THE END"
        || upper == "*** THE END ***"
        || upper.ends_with("[THE END]")
        || upper.ends_with("(THE END)")
}

/// Parse document blocks into a full interactive narrative graph.
pub fn parse_interactive_script(blocks: &[Block], story_title: &str) -> InteractiveGraph {
    let mut passages: Vec<InteractivePassage> = Vec::new();

    // Intermediate structure for accumulating current passage
    struct CurrentPassage {
        id: Id,
        title: String,
        tags: Vec<String>,
        content_lines: Vec<String>,
        choices: Vec<InteractiveChoice>,
        is_ending: bool,
        block_ids: Vec<Id>,
    }

    let mut current: Option<CurrentPassage> = None;

    let finish_passage = |cur: CurrentPassage, passages: &mut Vec<InteractivePassage>| {
        let content = cur.content_lines.join("\n\n").trim().to_string();
        let word_count = content.split_whitespace().count();
        let is_ending = cur.is_ending
            || cur.tags.iter().any(|t| {
                let tl = t.to_ascii_lowercase();
                tl == "end" || tl == "ending"
            })
            || cur.title.to_ascii_uppercase().contains("(END)")
            || cur.title.to_ascii_uppercase().contains("(ENDING)")
            || is_ending_text(&content);

        passages.push(InteractivePassage {
            id: cur.id,
            title: cur.title,
            tags: cur.tags,
            content,
            choices: cur.choices,
            is_start: false,
            is_ending,
            word_count,
            block_ids: cur.block_ids,
        });
    };

    for block in blocks {
        let is_heading = block.kind == BlockKind::Heading || block.kind == BlockKind::Section;
        let text = block.text();
        let trimmed = text.trim();

        if is_heading {
            if let Some(cur) = current.take() {
                finish_passage(cur, &mut passages);
            }

            // Parse passage title and optional tags: e.g. ":: The Cavern [dungeon cold]" or "Crossroads"
            let mut title_part = trimmed;
            if title_part.starts_with("::") {
                title_part = title_part[2..].trim();
            } else if title_part.to_ascii_lowercase().starts_with("passage:") {
                title_part = title_part[8..].trim();
            }

            let mut tags = Vec::new();
            if let Some(tag_start) = title_part.find('[') {
                if let Some(tag_end) = title_part[tag_start + 1..].find(']') {
                    let tag_str = &title_part[tag_start + 1..tag_start + 1 + tag_end].trim();
                    tags = tag_str
                        .split_whitespace()
                        .map(|s| s.to_string())
                        .collect();
                    title_part = title_part[..tag_start].trim();
                }
            }

            let p_id = block.scene_id.clone().unwrap_or_else(|| block.id.clone());
            let p_title = if title_part.is_empty() {
                format!("Passage {}", passages.len() + 1)
            } else {
                title_part.to_string()
            };

            current = Some(CurrentPassage {
                id: p_id,
                title: p_title,
                tags,
                content_lines: Vec::new(),
                choices: Vec::new(),
                is_ending: false,
                block_ids: vec![block.id.clone()],
            });
        } else {
            if current.is_none() {
                // Pre-heading blocks form an initial "Start" passage
                current = Some(CurrentPassage {
                    id: new_id(),
                    title: "Start".to_string(),
                    tags: vec!["start".to_string()],
                    content_lines: Vec::new(),
                    choices: Vec::new(),
                    is_ending: false,
                    block_ids: Vec::new(),
                });
            }

            let cur = current.as_mut().unwrap();
            cur.block_ids.push(block.id.clone());

            if !trimmed.is_empty() {
                cur.content_lines.push(trimmed.to_string());
                let found_choices = extract_choices(trimmed, &block.id);
                cur.choices.extend(found_choices);
                if is_ending_text(trimmed) {
                    cur.is_ending = true;
                }
            }
        }
    }

    if let Some(cur) = current.take() {
        finish_passage(cur, &mut passages);
    }

    // If document was completely empty, provide one initial start passage
    if passages.is_empty() {
        let start_id = new_id();
        passages.push(InteractivePassage {
            id: start_id.clone(),
            title: "Start".to_string(),
            tags: vec!["start".to_string()],
            content: "Welcome to your interactive branching story.".to_string(),
            choices: Vec::new(),
            is_start: true,
            is_ending: false,
            word_count: 6,
            block_ids: Vec::new(),
        });
    }

    // Determine starting passage:
    // Prefer passage titled "Start" or tagged "start", otherwise use the first passage.
    let start_idx = passages
        .iter()
        .position(|p| {
            p.title.eq_ignore_ascii_case("start")
                || p.tags.iter().any(|t| t.eq_ignore_ascii_case("start"))
        })
        .unwrap_or(0);

    for (i, p) in passages.iter_mut().enumerate() {
        p.is_start = i == start_idx;
    }

    let start_passage_id = passages[start_idx].id.clone();
    let validation = validate_graph(&passages, &start_passage_id);

    let total_passages = passages.len();
    let total_choices: usize = passages.iter().map(|p| p.choices.len()).sum();
    let total_endings: usize = passages.iter().filter(|p| p.is_ending).count();
    let total_words: usize = passages.iter().map(|p| p.word_count).sum();

    InteractiveGraph {
        story_title: story_title.trim().to_string(),
        ifid: uuid::Uuid::new_v4().to_string().to_uppercase(),
        start_passage_id,
        passages,
        total_passages,
        total_choices,
        total_endings,
        total_words,
        validation,
    }
}

/// Match a choice target against passages in the story.
fn find_target_passage_idx(target: &str, passages: &[InteractivePassage]) -> Option<usize> {
    let t_trim = target.trim();
    let t_slug = slugify(t_trim);

    // 1. Direct match on id
    if let Some(pos) = passages.iter().position(|p| p.id == t_trim) {
        return Some(pos);
    }

    // 2. Case-insensitive exact match on title
    if let Some(pos) = passages.iter().position(|p| p.title.trim().eq_ignore_ascii_case(t_trim)) {
        return Some(pos);
    }

    // 3. Slug match on title or id
    if !t_slug.is_empty() {
        if let Some(pos) = passages.iter().position(|p| slugify(&p.title) == t_slug || slugify(&p.id) == t_slug) {
            return Some(pos);
        }
    }

    None
}

/// Perform comprehensive graph integrity validation.
pub fn validate_graph(passages: &[InteractivePassage], start_passage_id: &str) -> GraphValidation {
    let mut issues = Vec::new();
    let mut dangling_count = 0usize;
    let mut dead_end_count = 0usize;
    let mut unreachable_count = 0usize;

    // 1. Check for dangling choice targets and dead ends
    for p in passages {
        if p.choices.is_empty() && !p.is_ending {
            dead_end_count += 1;
            issues.push(GraphIssue {
                kind: GraphIssueKind::DeadEnd,
                passage_id: p.id.clone(),
                passage_title: p.title.clone(),
                message: format!(
                    "Passage '{}' has no outgoing choices and is not marked as an ending.",
                    p.title
                ),
                choice_label: None,
                target: None,
            });
        }

        for c in &p.choices {
            if find_target_passage_idx(&c.target, passages).is_none() {
                dangling_count += 1;
                issues.push(GraphIssue {
                    kind: GraphIssueKind::DanglingTarget,
                    passage_id: p.id.clone(),
                    passage_title: p.title.clone(),
                    message: format!(
                        "Choice '{}' in passage '{}' points to non-existent target '{}'.",
                        c.label, p.title, c.target
                    ),
                    choice_label: Some(c.label.clone()),
                    target: Some(c.target.clone()),
                });
            }
        }
    }

    // 2. Check for unreachable passages using BFS traversal from start node
    let start_idx = passages
        .iter()
        .position(|p| p.id == start_passage_id)
        .unwrap_or(0);

    let mut visited: HashSet<usize> = HashSet::new();
    let mut queue: VecDeque<usize> = VecDeque::new();

    if !passages.is_empty() {
        visited.insert(start_idx);
        queue.push_back(start_idx);
    }

    while let Some(curr_idx) = queue.pop_front() {
        for choice in &passages[curr_idx].choices {
            if let Some(target_idx) = find_target_passage_idx(&choice.target, passages) {
                if visited.insert(target_idx) {
                    queue.push_back(target_idx);
                }
            }
        }
    }

    for (idx, p) in passages.iter().enumerate() {
        if !visited.contains(&idx) {
            unreachable_count += 1;
            issues.push(GraphIssue {
                kind: GraphIssueKind::Unreachable,
                passage_id: p.id.clone(),
                passage_title: p.title.clone(),
                message: format!(
                    "Passage '{}' cannot be reached by choices from the starting passage.",
                    p.title
                ),
                choice_label: None,
                target: None,
            });
        }
    }

    GraphValidation {
        is_valid: issues.is_empty(),
        issues,
        dangling_count,
        dead_end_count,
        unreachable_count,
    }
}

/// Export the interactive narrative graph in standard Twine / Twee 3 format.
pub fn export_twee(graph: &InteractiveGraph) -> String {
    let mut out = String::new();

    // StoryTitle header
    out.push_str(":: StoryTitle\n");
    out.push_str(&graph.story_title);
    out.push_str("\n\n");

    // StoryData JSON header
    let start_title = graph
        .passages
        .iter()
        .find(|p| p.id == graph.start_passage_id)
        .map(|p| p.title.as_str())
        .unwrap_or("Start");

    out.push_str(":: StoryData\n");
    let story_data = serde_json::json!({
        "ifid": graph.ifid,
        "format": "SugarCube",
        "format-version": "2.36.1",
        "start": start_title,
        "zoom": 1
    });
    out.push_str(&serde_json::to_string_pretty(&story_data).unwrap_or_default());
    out.push_str("\n\n");

    // Passages
    for (i, p) in graph.passages.iter().enumerate() {
        let x = (i % 4) * 260 + 100;
        let y = (i / 4) * 220 + 100;

        let tags_str = if p.tags.is_empty() {
            String::new()
        } else {
            format!(" [{}]", p.tags.join(" "))
        };

        out.push_str(&format!(
            ":: {}{} {{\"position\":\"{},{}\",\"size\":\"100,100\"}}\n",
            p.title, tags_str, x, y
        ));

        if !p.content.is_empty() {
            out.push_str(&p.content);
            out.push_str("\n\n");
        }

        // If choices weren't already embedded in the content body, append them
        for c in &p.choices {
            let choice_pattern = format!("[[{}", c.label);
            if !p.content.contains(&choice_pattern) {
                let cond_str = c
                    .condition
                    .as_ref()
                    .map(|cond| format!(" [if {}]", cond))
                    .unwrap_or_default();
                out.push_str(&format!("[[{} -> {}{}]]\n", c.label, c.target, cond_str));
            }
        }

        if !p.choices.is_empty() {
            out.push('\n');
        }
    }

    out
}

/// Export the interactive narrative graph as a standalone, playable offline HTML runner.
///
/// Fully self-contained single-file HTML with embedded responsive CSS and vanilla JS,
/// requiring zero external dependencies, CDN scripts, or network connections.
pub fn export_interactive_html(graph: &InteractiveGraph) -> String {
    let mut html = String::new();
    let graph_json = serde_json::to_string(graph).unwrap_or_else(|_| "{}".to_string());

    html.push_str("<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n");
    html.push_str("<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n");
    html.push_str(&format!("<title>{}</title>\n", graph.story_title));
    html.push_str("<style>\n");
    html.push_str("*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }\n");
    html.push_str("body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #0f141c; color: #e2e8f0; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; padding: 24px 16px; }\n");
    html.push_str(".story-container { width: 100%; max-width: 720px; background: #1a2230; border: 1px solid #2d3748; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); overflow: hidden; display: flex; flex-direction: column; }\n");
    html.push_str(".story-header { background: #141b26; border-bottom: 1px solid #2d3748; padding: 16px 24px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }\n");
    html.push_str(".story-title { font-size: 1.15rem; font-weight: 700; color: #f8fafc; letter-spacing: -0.01em; }\n");
    html.push_str(".story-stats { font-size: 0.85rem; color: #94a3b8; }\n");
    html.push_str(".story-nav-btn { background: #2d3748; color: #e2e8f0; border: 1px solid #4a5568; border-radius: 6px; padding: 6px 12px; font-size: 0.82rem; cursor: pointer; transition: all 0.15s ease; }\n");
    html.push_str(".story-nav-btn:hover:not(:disabled) { background: #4a5568; color: #fff; }\n");
    html.push_str(".story-nav-btn:disabled { opacity: 0.4; cursor: not-allowed; }\n");
    html.push_str(".story-body { padding: 32px 28px; flex: 1; display: flex; flex-direction: column; gap: 20px; line-height: 1.7; font-size: 1.06rem; }\n");
    html.push_str(".passage-title { font-size: 1.5rem; font-weight: 700; color: #60a5fa; border-bottom: 2px solid #2563eb; padding-bottom: 8px; margin-bottom: 8px; }\n");
    html.push_str(".passage-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }\n");
    html.push_str(".passage-tag { font-size: 0.75rem; background: #2563eb22; color: #93c5fd; border: 1px solid #3b82f644; border-radius: 4px; padding: 2px 8px; text-transform: uppercase; font-weight: 600; }\n");
    html.push_str(".passage-text { color: #cbd5e1; white-space: pre-line; word-break: break-word; }\n");
    html.push_str(".choices-container { margin-top: 24px; display: flex; flex-direction: column; gap: 12px; }\n");
    html.push_str(".choice-btn { background: #1e293b; color: #38bdf8; border: 1px solid #38bdf844; border-radius: 8px; padding: 14px 18px; font-size: 1rem; font-weight: 600; text-align: left; cursor: pointer; transition: all 0.2s ease; display: flex; justify-content: space-between; align-items: center; }\n");
    html.push_str(".choice-btn:hover { background: #0284c7; color: #ffffff; border-color: #38bdf8; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(2, 132, 199, 0.3); }\n");
    html.push_str(".choice-condition { font-size: 0.8rem; font-style: italic; opacity: 0.8; margin-left: 8px; }\n");
    html.push_str(".ending-box { background: #064e3b33; border: 1px solid #059669; border-radius: 8px; padding: 24px; text-align: center; margin-top: 20px; }\n");
    html.push_str(".ending-title { font-size: 1.4rem; font-weight: 800; color: #34d399; margin-bottom: 8px; letter-spacing: 1px; }\n");
    html.push_str(".ending-desc { font-size: 0.95rem; color: #a7f3d0; margin-bottom: 16px; }\n");
    html.push_str(".footer-trail { font-size: 0.8rem; color: #64748b; padding: 12px 24px; background: #141b26; border-top: 1px solid #2d3748; display: flex; justify-content: space-between; align-items: center; }\n");
    html.push_str("</style>\n</head>\n<body>\n");

    html.push_str("<div class=\"story-container\">\n");
    html.push_str("  <div class=\"story-header\">\n");
    html.push_str(&format!("    <div class=\"story-title\">{}</div>\n", graph.story_title));
    html.push_str("    <div style=\"display:flex;gap:8px;\">\n");
    html.push_str("      <button id=\"btn-undo\" class=\"story-nav-btn\" onclick=\"storyUndo()\" disabled>Back</button>\n");
    html.push_str("      <button id=\"btn-restart\" class=\"story-nav-btn\" onclick=\"storyRestart()\">Restart</button>\n");
    html.push_str("    </div>\n");
    html.push_str("  </div>\n");

    html.push_str("  <div id=\"story-body\" class=\"story-body\">\n");
    html.push_str("    <!-- Dynamic passage content renders here -->\n");
    html.push_str("  </div>\n");

    html.push_str("  <div class=\"footer-trail\">\n");
    html.push_str("    <span id=\"passage-counter\">Passage 1</span>\n");
    html.push_str("    <span id=\"history-trail\">Steps: 0</span>\n");
    html.push_str("  </div>\n");
    html.push_str("</div>\n");

    html.push_str("<script>\n");
    html.push_str(&format!("const STORY_DATA = {};\n", graph_json));
    html.push_str(r#"
let historyStack = [];
let currentPassageId = STORY_DATA.start_passage_id;

function findPassage(target) {
  if (!target) return null;
  const tTrim = target.trim();
  const tSlug = tTrim.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  for (const p of STORY_DATA.passages) {
    if (p.id === tTrim) return p;
    if (p.title.trim().toLowerCase() === tTrim.toLowerCase()) return p;
    const pSlug = p.title.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (pSlug && pSlug === tSlug) return p;
  }
  return null;
}

function renderCurrentPassage() {
  const p = findPassage(currentPassageId);
  const container = document.getElementById('story-body');
  if (!p) {
    container.innerHTML = '<div style="color:#ef4444;font-weight:bold;">Error: Passage not found.</div>';
    return;
  }

  let html = `<h1 class="passage-title">${p.title}</h1>`;

  if (p.tags && p.tags.length > 0) {
    html += '<div class="passage-tags">';
    for (const tag of p.tags) {
      html += `<span class="passage-tag">${tag}</span>`;
    }
    html += '</div>';
  }

  // Strip choice brackets from displayed narrative prose
  let cleanText = p.content.replace(/\[\[.*?\]\](?:\s*\(.*?\))?(?:\s*\{.*?\})?/g, '').trim();
  if (cleanText) {
    html += `<div class="passage-text">${cleanText}</div>`;
  }

  if (p.choices && p.choices.length > 0) {
    html += '<div class="choices-container">';
    for (const c of p.choices) {
      const condSpan = c.condition ? `<span class="choice-condition">(${c.condition})</span>` : '';
      html += `<button class="choice-btn" onclick="goToChoice('${encodeURIComponent(c.target)}')">${c.label} ${condSpan} &rarr;</button>`;
    }
    html += '</div>';
  }

  if (p.is_ending) {
    html += `
      <div class="ending-box">
        <div class="ending-title">THE END</div>
        <div class="ending-desc">You have reached the conclusion of this story pathway.</div>
        <button class="story-nav-btn" style="background:#059669;color:#fff;padding:10px 20px;font-size:0.95rem;" onclick="storyRestart()">Play Again</button>
      </div>`;
  }

  container.innerHTML = html;

  document.getElementById('btn-undo').disabled = historyStack.length === 0;
  document.getElementById('passage-counter').textContent = `Passage: ${p.title}`;
  document.getElementById('history-trail').textContent = `Steps: ${historyStack.length}`;
}

function goToChoice(encodedTarget) {
  const target = decodeURIComponent(encodedTarget);
  const nextP = findPassage(target);
  if (nextP) {
    historyStack.push(currentPassageId);
    currentPassageId = nextP.id;
    renderCurrentPassage();
  } else {
    alert("Target passage not found: " + target);
  }
}

function storyUndo() {
  if (historyStack.length > 0) {
    currentPassageId = historyStack.pop();
    renderCurrentPassage();
  }
}

function storyRestart() {
  historyStack = [];
  currentPassageId = STORY_DATA.start_passage_id;
  renderCurrentPassage();
}

window.addEventListener('DOMContentLoaded', () => {
  renderCurrentPassage();
});
"#);
    html.push_str("</script>\n</body>\n</html>");

    html
}

/// Export the interactive narrative graph as structured JSON for game engines and analysis.
pub fn export_interactive_json(graph: &InteractiveGraph) -> String {
    serde_json::to_string_pretty(graph).unwrap_or_else(|_| "{}".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_interactive_blocks() -> Vec<Block> {
        vec![
            Block::new(BlockKind::Heading, ":: Crossroads [start eerie]"),
            Block::new(
                BlockKind::Action,
                "You stand at a foggy junction in the ancient forest. Two trails diverge before you.",
            ),
            Block::new(
                BlockKind::Action,
                "[[Take the northern mountain path -> NorthPath]]",
            ),
            Block::new(
                BlockKind::Action,
                "[[Descend into the southern valley -> SouthValley]]",
            ),
            Block::new(
                BlockKind::Action,
                "[[Inspect the ruined shrine -> RuinedShrine [if has_amulet]]]",
            ),
            Block::new(BlockKind::Heading, ":: NorthPath [mountain]"),
            Block::new(
                BlockKind::Action,
                "A biting wind tears across the rocky ridge. A sheer cliff blocks your way.",
            ),
            Block::new(
                BlockKind::Action,
                "[[Climb the ancient stone stairs -> MountainSummit]]",
            ),
            Block::new(
                BlockKind::Action,
                "[[Return to the crossroads -> Crossroads]]",
            ),
            Block::new(BlockKind::Heading, ":: SouthValley [valley]"),
            Block::new(
                BlockKind::Action,
                "Lush bioluminescent moss illuminates the damp cavern floor.",
            ),
            Block::new(
                BlockKind::Action,
                "[[Enter the hidden crystal grotto -> CrystalGrotto]]",
            ),
            Block::new(BlockKind::Heading, ":: MountainSummit [end victory]"),
            Block::new(
                BlockKind::Action,
                "You reach the beacon tower at the mountain crest and light the signal fire.\n\n[THE END]",
            ),
            Block::new(BlockKind::Heading, ":: CrystalGrotto [end peaceful]"),
            Block::new(
                BlockKind::Action,
                "You rest beside the glowing pools, finding peace in the forgotten underworld.\n\n*** THE END ***",
            ),
            Block::new(BlockKind::Heading, ":: RuinedShrine [ancient]"),
            Block::new(
                BlockKind::Action,
                "Ancient carvings glow softly in response to your amulet.",
            ),
            Block::new(
                BlockKind::Action,
                "[[Return to the crossroads -> Crossroads]]",
            ),
        ]
    }

    #[test]
    fn test_parse_choice_inner_variations() {
        // Arrow
        let (label, target, cond) = parse_choice_inner("Enter the vault -> Vault");
        assert_eq!(label, "Enter the vault");
        assert_eq!(target, "Vault");
        assert!(cond.is_none());

        // Reverse arrow
        let (label, target, cond) = parse_choice_inner("Vault <- Enter the vault");
        assert_eq!(label, "Enter the vault");
        assert_eq!(target, "Vault");
        assert!(cond.is_none());

        // Pipe
        let (label, target, cond) = parse_choice_inner("Enter the vault|Vault");
        assert_eq!(label, "Enter the vault");
        assert_eq!(target, "Vault");
        assert!(cond.is_none());

        // Single target
        let (label, target, cond) = parse_choice_inner("Vault");
        assert_eq!(label, "Vault");
        assert_eq!(target, "Vault");
        assert!(cond.is_none());

        // With condition inside bracket
        let (label, target, cond) = parse_choice_inner("Open chest -> Treasure [if has_key]");
        assert_eq!(label, "Open chest");
        assert_eq!(target, "Treasure");
        assert_eq!(cond, Some("has_key".to_string()));
    }

    #[test]
    fn test_extract_choices_with_trailing_conditions() {
        let block_id = new_id();
        let text = "[[Open iron gate -> Dungeon]] (requires iron_key)\n[[Flee back -> Forest]]";
        let choices = extract_choices(text, &block_id);
        assert_eq!(choices.len(), 2);
        assert_eq!(choices[0].label, "Open iron gate");
        assert_eq!(choices[0].target, "Dungeon");
        assert_eq!(choices[0].condition, Some("requires iron_key".to_string()));
        assert_eq!(choices[1].label, "Flee back");
        assert_eq!(choices[1].target, "Forest");
        assert!(choices[1].condition.is_none());
    }

    #[test]
    fn test_parse_interactive_script_graph() {
        let blocks = sample_interactive_blocks();
        let graph = parse_interactive_script(&blocks, "The Foggy Realm");

        assert_eq!(graph.story_title, "The Foggy Realm");
        assert_eq!(graph.total_passages, 6);
        assert_eq!(graph.total_endings, 2);
        assert!(graph.validation.is_valid);
        assert_eq!(graph.validation.dangling_count, 0);
        assert_eq!(graph.validation.dead_end_count, 0);
        assert_eq!(graph.validation.unreachable_count, 0);

        let start = graph.passages.iter().find(|p| p.is_start).unwrap();
        assert_eq!(start.title, "Crossroads");
        assert_eq!(start.choices.len(), 3);
        assert_eq!(start.choices[2].condition, Some("has_amulet".to_string()));
    }

    #[test]
    fn test_graph_validation_detects_issues() {
        let invalid_blocks = vec![
            Block::new(BlockKind::Heading, ":: Start"),
            Block::new(
                BlockKind::Action,
                "[[Go to mysterious void -> NonExistentPassage]]",
            ),
            Block::new(BlockKind::Heading, ":: DeadEndRoom"),
            Block::new(BlockKind::Action, "A quiet room with no exits and no ending marker."),
            Block::new(BlockKind::Heading, ":: IslandPassage"),
            Block::new(BlockKind::Action, "Nobody can ever reach this island."),
        ];

        let graph = parse_interactive_script(&invalid_blocks, "Broken Story");
        assert!(!graph.validation.is_valid);
        assert_eq!(graph.validation.dangling_count, 1);
        assert_eq!(graph.validation.dead_end_count, 2); // DeadEndRoom and IslandPassage
        assert_eq!(graph.validation.unreachable_count, 2); // DeadEndRoom and IslandPassage
    }

    #[test]
    fn test_export_twee_format() {
        let blocks = sample_interactive_blocks();
        let graph = parse_interactive_script(&blocks, "Twee Adventure");
        let twee = export_twee(&graph);

        assert!(twee.contains(":: StoryTitle\nTwee Adventure"));
        assert!(twee.contains(":: StoryData"));
        assert!(twee.contains("\"start\": \"Crossroads\""));
        assert!(twee.contains(":: Crossroads [start eerie]"));
        assert!(twee.contains(":: MountainSummit [end victory]"));
    }

    #[test]
    fn test_export_interactive_html() {
        let blocks = sample_interactive_blocks();
        let graph = parse_interactive_script(&blocks, "HTML Adventure");
        let html = export_interactive_html(&graph);

        assert!(html.contains("<!DOCTYPE html>"));
        assert!(html.contains("<title>HTML Adventure</title>"));
        assert!(html.contains("const STORY_DATA = {"));
        assert!(html.contains("function renderCurrentPassage()"));
        assert!(html.contains("function goToChoice("));
        assert!(!html.contains("http://"));
        assert!(!html.contains("https://")); // Strict offline rule
    }

    #[test]
    fn test_export_interactive_json() {
        let blocks = sample_interactive_blocks();
        let graph = parse_interactive_script(&blocks, "JSON Adventure");
        let json_str = export_interactive_json(&graph);

        assert!(json_str.contains("\"story_title\": \"JSON Adventure\""));
        assert!(json_str.contains("\"total_passages\": 6"));
        assert!(json_str.contains("\"is_valid\": true"));
    }
}
