//! Offline grammar, style, and dialogue analysis engine (M6 step 6, ROADMAP M6).
//!
//! Provides 100% offline, deterministic rule-based checks for:
//! - Repeated duplicate words (`the the`);
//! - Passive voice in action lines (`is seen`, `was opened by`);
//! - Screenplay dialogue punctuation rules (unquoted dialogue, parenthetical formatting);
//! - Screenplay cliches and filler phrases (`we see`, `we hear`, `suddenly`, `begins to`);
//! - Spacing and punctuation consistency (double spaces, space before punctuation, missing space after punctuation).

use crate::model::{new_id, Block, BlockKind, Id, Run};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// Category of the grammar or style issue.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GrammarIssueCategory {
    DuplicateWords,
    PassiveVoice,
    ScreenplayPunctuation,
    ClichesAndFillers,
    SpacingAndPunctuation,
}

/// Severity classification of the issue.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GrammarSeverity {
    Suggestion,
    Warning,
}

/// A specific grammar, style, or punctuation issue identified in a manuscript block.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GrammarIssue {
    pub id: Id,
    pub rule_id: String,
    pub category: GrammarIssueCategory,
    pub severity: GrammarSeverity,
    pub message: String,
    pub block_id: Id,
    pub block_kind: BlockKind,
    /// UTF-16 code unit offset within the block's text.
    pub offset: usize,
    /// UTF-16 code unit length of the matched text.
    pub length: usize,
    pub matched_text: String,
    /// Suggested replacement text (if automatable with one click).
    pub replacement: Option<String>,
    /// Context excerpt around the matched text for preview.
    pub context: String,
}

/// Full analysis report summarizing grammar, style, and dialogue findings.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GrammarAnalysisReport {
    pub total_issues: usize,
    pub duplicate_words_count: usize,
    pub passive_voice_count: usize,
    pub screenplay_punctuation_count: usize,
    pub cliches_count: usize,
    pub spacing_count: usize,
    pub issues: Vec<GrammarIssue>,
}

/// Helper to convert a byte or char offset to UTF-16 code unit offset.
fn utf16_offset(full_text: &str, byte_idx: usize) -> usize {
    full_text[..byte_idx].encode_utf16().count()
}

/// Helper to extract context excerpt around a span.
fn make_context(text: &str, start_byte: usize, end_byte: usize) -> String {
    let pre = text[..start_byte].chars().rev().take(25).collect::<String>();
    let pre_clean: String = pre.chars().rev().collect();
    let mid = &text[start_byte..end_byte];
    let post: String = text[end_byte..].chars().take(25).collect();

    let prefix = if pre_clean.len() == 25 { "..." } else { "" };
    let suffix = if post.len() == 25 { "..." } else { "" };

    format!("{}{}{}{}{}", prefix, pre_clean, mid, post, suffix)
}

/// Check for repeated duplicate words (e.g. "the the", "and and").
fn check_duplicate_words(block: &Block, issues: &mut Vec<GrammarIssue>, ignored: &HashSet<String>) {
    let text = block.text();
    let words: Vec<(usize, usize, &str)> = {
        let mut list = Vec::new();
        let mut in_word = false;
        let mut start_byte = 0;

        for (byte_idx, c) in text.char_indices() {
            if c.is_alphabetic() || c == '\'' || c == '’' {
                if !in_word {
                    in_word = true;
                    start_byte = byte_idx;
                }
            } else if in_word {
                in_word = false;
                list.push((start_byte, byte_idx, &text[start_byte..byte_idx]));
            }
        }
        if in_word {
            list.push((start_byte, text.len(), &text[start_byte..]));
        }
        list
    };

    if words.len() < 2 {
        return;
    }

    for i in 0..words.len() - 1 {
        let (w1_start, w1_end, w1_text) = words[i];
        let (w2_start, w2_end, w2_text) = words[i + 1];

        // Ensure between words is only whitespace or minimal punctuation
        let between = &text[w1_end..w2_start];
        if between.trim().is_empty() && w1_text.eq_ignore_ascii_case(w2_text) {
            let lower = w1_text.to_lowercase();
            if ignored.contains(&lower) {
                continue;
            }

            let start_byte = w1_start;
            let end_byte = w2_end;
            let u16_start = utf16_offset(&text, start_byte);
            let u16_len = text[start_byte..end_byte].encode_utf16().count();
            let matched = text[start_byte..end_byte].to_string();

            issues.push(GrammarIssue {
                id: new_id(),
                rule_id: "duplicate_word".to_string(),
                category: GrammarIssueCategory::DuplicateWords,
                severity: GrammarSeverity::Warning,
                message: format!("Repeated word '{}'.", w1_text),
                block_id: block.id.clone(),
                block_kind: block.kind,
                offset: u16_start,
                length: u16_len,
                matched_text: matched,
                replacement: Some(w1_text.to_string()),
                context: make_context(&text, start_byte, end_byte),
            });
        }
    }
}

/// Check for passive voice constructions in action lines.
fn check_passive_voice(block: &Block, issues: &mut Vec<GrammarIssue>, ignored: &HashSet<String>) {
    if block.kind != BlockKind::Action {
        return;
    }

    let text = block.text();
    let text_lower = text.to_lowercase();

    let passive_phrases = [
        "is seen",
        "can be seen",
        "are seen",
        "is heard",
        "can be heard",
        "are heard",
        "is noticed",
        "can be noticed",
        "was opened by",
        "is opened by",
        "was struck by",
        "is struck by",
        "was broken by",
        "is broken by",
        "is being chased by",
        "was taken by",
        "is taken by",
        "was watched by",
        "is watched by",
        "was found by",
        "is found by",
        "was destroyed by",
        "is destroyed by",
    ];

    for phrase in passive_phrases {
        if ignored.contains(phrase) {
            continue;
        }

        for (byte_idx, _) in text_lower.match_indices(phrase) {
            // Check word boundaries
            let before_ok = byte_idx == 0
                || !text_lower[..byte_idx]
                    .chars()
                    .last()
                    .unwrap()
                    .is_alphabetic();
            let after_idx = byte_idx + phrase.len();
            let after_ok = after_idx == text_lower.len()
                || !text_lower[after_idx..]
                    .chars()
                    .next()
                    .unwrap()
                    .is_alphabetic();

            if before_ok && after_ok {
                let u16_start = utf16_offset(&text, byte_idx);
                let u16_len = text[byte_idx..after_idx].encode_utf16().count();
                let matched = text[byte_idx..after_idx].to_string();

                issues.push(GrammarIssue {
                    id: new_id(),
                    rule_id: "passive_voice".to_string(),
                    category: GrammarIssueCategory::PassiveVoice,
                    severity: GrammarSeverity::Suggestion,
                    message: format!(
                        "Passive construction '{}'. Screenplays favor active, present-tense verbs.",
                        matched
                    ),
                    block_id: block.id.clone(),
                    block_kind: block.kind,
                    offset: u16_start,
                    length: u16_len,
                    matched_text: matched,
                    replacement: None,
                    context: make_context(&text, byte_idx, after_idx),
                });
            }
        }
    }
    issues.sort_by_key(|i| i.offset);
}

/// Check for screenplay dialogue and parenthetical formatting conventions.
fn check_screenplay_punctuation(block: &Block, issues: &mut Vec<GrammarIssue>) {
    let text = block.text();
    let trimmed = text.trim();

    match block.kind {
        BlockKind::Dialogue => {
            // Rule 1: Outer quotation marks in dialogue lines
            let has_double_quotes = (trimmed.starts_with('"') && trimmed.ends_with('"') && trimmed.len() >= 2)
                || (trimmed.starts_with('“') && trimmed.ends_with('”') && trimmed.len() >= 2);

            if has_double_quotes {
                let inner = &trimmed[1..trimmed.len() - 1].trim();
                let start_byte = text.find(&trimmed[..1]).unwrap_or(0);
                let end_byte = text.rfind(&trimmed[trimmed.len() - 1..]).map(|i| i + 1).unwrap_or(text.len());
                let u16_start = utf16_offset(&text, start_byte);
                let u16_len = text[start_byte..end_byte].encode_utf16().count();

                issues.push(GrammarIssue {
                    id: new_id(),
                    rule_id: "dialogue_quotes".to_string(),
                    category: GrammarIssueCategory::ScreenplayPunctuation,
                    severity: GrammarSeverity::Warning,
                    message: "Screenplay dialogue should not be enclosed in quotation marks.".to_string(),
                    block_id: block.id.clone(),
                    block_kind: block.kind,
                    offset: u16_start,
                    length: u16_len,
                    matched_text: trimmed.to_string(),
                    replacement: Some(inner.to_string()),
                    context: make_context(&text, start_byte, end_byte),
                });
            }
        }
        BlockKind::Parenthetical => {
            // Rule 2: Parentheticals must be wrapped in ()
            if !trimmed.starts_with('(') || !trimmed.ends_with(')') {
                let u16_len = text.encode_utf16().count();
                issues.push(GrammarIssue {
                    id: new_id(),
                    rule_id: "parenthetical_parens".to_string(),
                    category: GrammarIssueCategory::ScreenplayPunctuation,
                    severity: GrammarSeverity::Warning,
                    message: "Parenthetical must be enclosed in parentheses: '(whispering)'.".to_string(),
                    block_id: block.id.clone(),
                    block_kind: block.kind,
                    offset: 0,
                    length: u16_len,
                    matched_text: trimmed.to_string(),
                    replacement: Some(format!("({})", trimmed)),
                    context: trimmed.to_string(),
                });
            } else {
                let inner = &trimmed[1..trimmed.len() - 1].trim();

                // Rule 3: Lowercase and no terminal period in parentheticals
                let has_terminal_period = inner.ends_with('.');
                let starts_with_capital = inner.chars().next().map_or(false, |c| c.is_uppercase());

                if has_terminal_period || starts_with_capital {
                    let clean = inner.trim_end_matches('.').to_lowercase();
                    let u16_len = text.encode_utf16().count();

                    issues.push(GrammarIssue {
                        id: new_id(),
                        rule_id: "parenthetical_casing".to_string(),
                        category: GrammarIssueCategory::ScreenplayPunctuation,
                        severity: GrammarSeverity::Suggestion,
                        message: "Screenplay parentheticals are typically lowercase and omit terminal periods: '(whispering)' instead of '(Whispering.)'.".to_string(),
                        block_id: block.id.clone(),
                        block_kind: block.kind,
                        offset: 0,
                        length: u16_len,
                        matched_text: trimmed.to_string(),
                        replacement: Some(format!("({})", clean)),
                        context: trimmed.to_string(),
                    });
                }

                // Rule 4: Overly long parenthetical (> 7 words)
                let word_count = inner.split_whitespace().count();
                if word_count > 7 {
                    let u16_len = text.encode_utf16().count();
                    issues.push(GrammarIssue {
                        id: new_id(),
                        rule_id: "parenthetical_length".to_string(),
                        category: GrammarIssueCategory::ScreenplayPunctuation,
                        severity: GrammarSeverity::Suggestion,
                        message: format!(
                            "Parenthetical has {} words. Parentheticals should be brief acting cues (1–4 words); longer directions belong in an action line.",
                            word_count
                        ),
                        block_id: block.id.clone(),
                        block_kind: block.kind,
                        offset: 0,
                        length: u16_len,
                        matched_text: trimmed.to_string(),
                        replacement: None,
                        context: trimmed.to_string(),
                    });
                }
            }
        }
        _ => {}
    }
}

/// Check for cliches and filler expressions in action lines.
fn check_cliches_and_fillers(block: &Block, issues: &mut Vec<GrammarIssue>, ignored: &HashSet<String>) {
    if block.kind != BlockKind::Action {
        return;
    }

    let text = block.text();
    let text_lower = text.to_lowercase();

    let cliches = [
        ("we see", "Avoid 'we see' in spec scripts; describe the visual action directly."),
        ("we can see", "Avoid 'we can see'; describe what is visible directly."),
        ("we hear", "Avoid 'we hear'; describe the sound directly."),
        ("we can hear", "Avoid 'we can hear'; describe the sound directly."),
        ("we notice", "Avoid 'we notice'; describe the focal point directly."),
        ("camera pans", "Avoid camera directions in spec scripts; focus on the scene."),
        ("camera zooms", "Avoid camera directions in spec scripts; focus on the scene."),
        ("camera tracks", "Avoid camera directions in spec scripts; focus on the scene."),
        ("suddenly", "'Suddenly' is often redundant in action lines; cut straight to the event."),
        ("all of a sudden", "'All of a sudden' is filler; state the action directly."),
        ("begins to", "'Begins to' weakens action; use the active verb ('runs' instead of 'begins to run')."),
        ("starts to", "'Starts to' weakens action; use the active verb ('walks' instead of 'starts to walk')."),
    ];

    for (cliche, advice) in cliches {
        if ignored.contains(cliche) {
            continue;
        }

        for (byte_idx, _) in text_lower.match_indices(cliche) {
            let before_ok = byte_idx == 0
                || !text_lower[..byte_idx]
                    .chars()
                    .last()
                    .unwrap()
                    .is_alphabetic();
            let after_idx = byte_idx + cliche.len();
            let after_ok = after_idx == text_lower.len()
                || !text_lower[after_idx..]
                    .chars()
                    .next()
                    .unwrap()
                    .is_alphabetic();

            if before_ok && after_ok {
                let u16_start = utf16_offset(&text, byte_idx);
                let u16_len = text[byte_idx..after_idx].encode_utf16().count();
                let matched = text[byte_idx..after_idx].to_string();

                issues.push(GrammarIssue {
                    id: new_id(),
                    rule_id: format!("cliche_{}", cliche.replace(' ', "_")),
                    category: GrammarIssueCategory::ClichesAndFillers,
                    severity: GrammarSeverity::Suggestion,
                    message: advice.to_string(),
                    block_id: block.id.clone(),
                    block_kind: block.kind,
                    offset: u16_start,
                    length: u16_len,
                    matched_text: matched,
                    replacement: None,
                    context: make_context(&text, byte_idx, after_idx),
                });
            }
        }
    }
    issues.sort_by_key(|i| i.offset);
}

/// Check for spacing anomalies and punctuation consistency.
fn check_spacing_and_punctuation(block: &Block, issues: &mut Vec<GrammarIssue>) {
    let text = block.text();

    // 1. Double or multiple spaces
    for (byte_idx, _) in text.match_indices("  ") {
        // Skip if preceded by a space to avoid reporting every single byte in a long sequence
        if byte_idx > 0 && text.as_bytes()[byte_idx - 1] == b' ' {
            continue;
        }

        // Measure how many consecutive spaces
        let space_run_len = text[byte_idx..].chars().take_while(|&c| c == ' ').count();
        let end_byte = byte_idx + space_run_len;
        let u16_start = utf16_offset(&text, byte_idx);
        let u16_len = space_run_len;

        issues.push(GrammarIssue {
            id: new_id(),
            rule_id: "multiple_spaces".to_string(),
            category: GrammarIssueCategory::SpacingAndPunctuation,
            severity: GrammarSeverity::Warning,
            message: format!("Multiple consecutive spaces ({} spaces).", space_run_len),
            block_id: block.id.clone(),
            block_kind: block.kind,
            offset: u16_start,
            length: u16_len,
            matched_text: " ".repeat(space_run_len),
            replacement: Some(" ".to_string()),
            context: make_context(&text, byte_idx, end_byte),
        });
    }

    // 2. Space before punctuation marks: e.g. "word ," or "word ." or "word !"
    let puncts = [',', '.', '!', '?', ';', ':'];
    for (byte_idx, c) in text.char_indices() {
        if puncts.contains(&c) && byte_idx > 0 {
            let prev_byte = text.as_bytes()[byte_idx - 1];
            if prev_byte == b' ' {
                // Ensure it's not an intentional ellipsis like " . . ."
                if c == '.' && byte_idx + 1 < text.len() && text.as_bytes()[byte_idx + 1] == b'.' {
                    continue;
                }

                let start_byte = byte_idx - 1;
                let end_byte = byte_idx + c.len_utf8();
                let u16_start = utf16_offset(&text, start_byte);
                let u16_len = text[start_byte..end_byte].encode_utf16().count();
                let matched = text[start_byte..end_byte].to_string();

                issues.push(GrammarIssue {
                    id: new_id(),
                    rule_id: "space_before_punct".to_string(),
                    category: GrammarIssueCategory::SpacingAndPunctuation,
                    severity: GrammarSeverity::Warning,
                    message: format!("Unexpected space before punctuation '{}'.", c),
                    block_id: block.id.clone(),
                    block_kind: block.kind,
                    offset: u16_start,
                    length: u16_len,
                    matched_text: matched,
                    replacement: Some(c.to_string()),
                    context: make_context(&text, start_byte, end_byte),
                });
            }
        }
    }

    // 3. Missing space after comma: e.g. "hello,world"
    for (byte_idx, c) in text.char_indices() {
        if c == ',' && byte_idx + 1 < text.len() {
            let next_char = text[byte_idx + 1..].chars().next().unwrap();
            // Comma followed directly by letter (not a number like 1,000)
            if next_char.is_alphabetic() {
                let start_byte = byte_idx;
                let end_byte = byte_idx + 1 + next_char.len_utf8();
                let u16_start = utf16_offset(&text, start_byte);
                let u16_len = text[start_byte..end_byte].encode_utf16().count();
                let matched = text[start_byte..end_byte].to_string();

                issues.push(GrammarIssue {
                    id: new_id(),
                    rule_id: "missing_space_after_comma".to_string(),
                    category: GrammarIssueCategory::SpacingAndPunctuation,
                    severity: GrammarSeverity::Warning,
                    message: "Missing space after comma.".to_string(),
                    block_id: block.id.clone(),
                    block_kind: block.kind,
                    offset: u16_start,
                    length: u16_len,
                    matched_text: matched,
                    replacement: Some(format!(", {}", next_char)),
                    context: make_context(&text, start_byte, end_byte),
                });
            }
        }
    }
    issues.sort_by_key(|i| i.offset);
}

/// Analyze a sequence of blocks and generate a comprehensive grammar and style report.
pub fn analyze_grammar(
    blocks: &[Block],
    ignored_rules: &[String],
    ignored_words: &[String],
) -> GrammarAnalysisReport {
    let mut issues = Vec::new();
    let ignored_rules_set: HashSet<String> = ignored_rules.iter().cloned().collect();
    let ignored_words_set: HashSet<String> = ignored_words
        .iter()
        .map(|s| s.trim().to_lowercase())
        .collect();

    for block in blocks {
        if !ignored_rules_set.contains("duplicate_word") {
            check_duplicate_words(block, &mut issues, &ignored_words_set);
        }
        if !ignored_rules_set.contains("passive_voice") {
            check_passive_voice(block, &mut issues, &ignored_words_set);
        }
        if !ignored_rules_set.contains("screenplay_punctuation") {
            check_screenplay_punctuation(block, &mut issues);
        }
        if !ignored_rules_set.contains("cliches") {
            check_cliches_and_fillers(block, &mut issues, &ignored_words_set);
        }
        if !ignored_rules_set.contains("spacing") {
            check_spacing_and_punctuation(block, &mut issues);
        }
    }

    let mut duplicate_words_count = 0usize;
    let mut passive_voice_count = 0usize;
    let mut screenplay_punctuation_count = 0usize;
    let mut cliches_count = 0usize;
    let mut spacing_count = 0usize;

    for issue in &issues {
        match issue.category {
            GrammarIssueCategory::DuplicateWords => duplicate_words_count += 1,
            GrammarIssueCategory::PassiveVoice => passive_voice_count += 1,
            GrammarIssueCategory::ScreenplayPunctuation => screenplay_punctuation_count += 1,
            GrammarIssueCategory::ClichesAndFillers => cliches_count += 1,
            GrammarIssueCategory::SpacingAndPunctuation => spacing_count += 1,
        }
    }

    GrammarAnalysisReport {
        total_issues: issues.len(),
        duplicate_words_count,
        passive_voice_count,
        screenplay_punctuation_count,
        cliches_count,
        spacing_count,
        issues,
    }
}

/// Apply a one-click fix to a manuscript block, replacing the matched span with suggested text.
pub fn apply_grammar_fix(block: &Block, offset: usize, length: usize, replacement: &str) -> Block {
    let text = block.text();
    let utf16_chars: Vec<u16> = text.encode_utf16().collect();

    if offset > utf16_chars.len() || offset + length > utf16_chars.len() {
        return block.clone();
    }

    let pre = String::from_utf16_lossy(&utf16_chars[..offset]);
    let post = String::from_utf16_lossy(&utf16_chars[offset + length..]);
    let new_text = format!("{}{}{}", pre, replacement, post);

    let mut updated = block.clone();
    if block.runs.len() <= 1 {
        let bold = block.runs.first().map_or(false, |r| r.bold);
        let italic = block.runs.first().map_or(false, |r| r.italic);
        let underline = block.runs.first().map_or(false, |r| r.underline);
        let color = block.runs.first().and_then(|r| r.color.clone());
        let highlight = block.runs.first().and_then(|r| r.highlight.clone());
        let revision = block.runs.first().and_then(|r| r.revision.clone());
        updated.runs = vec![Run {
            text: new_text,
            bold,
            italic,
            underline,
            color,
            highlight,
            revision,
        }];
    } else {
        // Plain fallback for multi-run block replacement
        updated.runs = vec![Run::plain(new_text)];
    }

    updated
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_duplicate_words_detection() {
        let block = Block::new(BlockKind::Action, "She stepped into the the abandoned church.");
        let mut issues = Vec::new();
        check_duplicate_words(&block, &mut issues, &HashSet::new());

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].rule_id, "duplicate_word");
        assert_eq!(issues[0].matched_text, "the the");
        assert_eq!(issues[0].replacement, Some("the".to_string()));
    }

    #[test]
    fn test_passive_voice_detection() {
        let block = Block::new(
            BlockKind::Action,
            "The iron vault was opened by Marcus while a shadow is seen in the hallway.",
        );
        let mut issues = Vec::new();
        check_passive_voice(&block, &mut issues, &HashSet::new());

        assert_eq!(issues.len(), 2);
        assert_eq!(issues[0].matched_text, "was opened by");
        assert_eq!(issues[1].matched_text, "is seen");
    }

    #[test]
    fn test_screenplay_dialogue_quotes_detection() {
        let block = Block::new(BlockKind::Dialogue, "\"I told you never to return here.\"");
        let mut issues = Vec::new();
        check_screenplay_punctuation(&block, &mut issues);

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].rule_id, "dialogue_quotes");
        assert_eq!(
            issues[0].replacement,
            Some("I told you never to return here.".to_string())
        );
    }

    #[test]
    fn test_parenthetical_casing_and_punctuation() {
        let block = Block::new(BlockKind::Parenthetical, "(Whispering quietly.)");
        let mut issues = Vec::new();
        check_screenplay_punctuation(&block, &mut issues);

        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].rule_id, "parenthetical_casing");
        assert_eq!(
            issues[0].replacement,
            Some("(whispering quietly)".to_string())
        );
    }

    #[test]
    fn test_cliches_and_fillers_detection() {
        let block = Block::new(
            BlockKind::Action,
            "Suddenly, we see a hooded figure as she begins to run toward the tree line.",
        );
        let mut issues = Vec::new();
        check_cliches_and_fillers(&block, &mut issues, &HashSet::new());

        assert_eq!(issues.len(), 3); // suddenly, we see, begins to
        let rules: Vec<&str> = issues.iter().map(|i| i.rule_id.as_str()).collect();
        assert!(rules.contains(&"cliche_suddenly"));
        assert!(rules.contains(&"cliche_we_see"));
        assert!(rules.contains(&"cliche_begins_to"));
    }

    #[test]
    fn test_spacing_and_punctuation_checks() {
        let block = Block::new(
            BlockKind::Action,
            "He paused  before the door ,wondering what lay beyond .",
        );
        let mut issues = Vec::new();
        check_spacing_and_punctuation(&block, &mut issues);

        assert_eq!(issues.len(), 4); // double space, space before comma, missing space after comma, space before period
        let rules: Vec<&str> = issues.iter().map(|i| i.rule_id.as_str()).collect();
        assert!(rules.contains(&"multiple_spaces"));
        assert!(rules.contains(&"space_before_punct"));
        assert!(rules.contains(&"missing_space_after_comma"));
    }

    #[test]
    fn test_apply_grammar_fix() {
        let block = Block::new(BlockKind::Dialogue, "\"Hello world!\"");
        let fixed = apply_grammar_fix(&block, 0, 14, "Hello world!");
        assert_eq!(fixed.text(), "Hello world!");
    }
}
