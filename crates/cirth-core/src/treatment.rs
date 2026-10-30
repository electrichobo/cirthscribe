//! General rich-text treatment documents, pitch bibles, and project bible integration (M6 step 5, ROADMAP M6).
//!
//! Provides structured treatment hierarchy parsing (Headings H1–H3, body paragraphs,
//! bullet/numbered lists, blockquotes, character spotlights), cross-referencing with
//! canonical project bible entities (characters, locations, tags), reading time metrics,
//! and dedicated exports in semantic HTML, formatted Plain Text, and DOCX.

use crate::bible::Entity;
use crate::layout::Profile;
use crate::model::{Block, BlockKind, Id, Run};
use crate::printdoc::DocOptions;
use serde::{Deserialize, Serialize};

/// Structural classification for elements in a rich-text treatment or pitch bible.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TreatmentSectionKind {
    /// Major Part / Act / Document Heading (H1)
    Heading1,
    /// Section / Chapter / Sequence (H2)
    Heading2,
    /// Subsection / Beat / Scene Synopsis (H3)
    Heading3,
    /// Body paragraph prose
    Paragraph,
    /// Blockquote or thematic epigraph
    Blockquote,
    /// List item (bullet or numbered)
    ListItem,
    /// Character focus or cast spotlight
    Character,
}

/// An individual structural item in the treatment manuscript.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TreatmentItem {
    pub id: Id,
    pub kind: TreatmentSectionKind,
    pub text: String,
    pub runs: Vec<Run>,
    pub block_id: Id,
}

/// A cross-referenced entity from the Project Bible appearing in the treatment.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TreatmentEntityMention {
    pub entity_id: Id,
    pub entity_name: String,
    pub kind: String,
    pub count: usize,
    pub block_ids: Vec<Id>,
}

/// Full treatment document analysis with structural breakdown, reading metrics, and Bible mentions.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TreatmentDoc {
    pub title: String,
    pub subtitle: Option<String>,
    pub items: Vec<TreatmentItem>,
    pub total_headings: usize,
    pub total_paragraphs: usize,
    pub total_quotes: usize,
    pub total_lists: usize,
    pub total_words: usize,
    pub reading_time_mins: usize,
    pub mentions: Vec<TreatmentEntityMention>,
}

/// Check if a text string contains a target name as a distinct word boundary.
pub fn matches_entity_name(text: &str, target: &str) -> bool {
    let t_norm = text.to_lowercase();
    let target_norm = target.trim().to_lowercase();
    if target_norm.is_empty() {
        return false;
    }

    for (idx, _) in t_norm.match_indices(&target_norm) {
        let before_ok = idx == 0 || !t_norm[..idx].chars().last().unwrap().is_alphanumeric();
        let after_idx = idx + target_norm.len();
        let after_ok = after_idx == t_norm.len()
            || !t_norm[after_idx..]
                .chars()
                .next()
                .unwrap()
                .is_alphanumeric();
        if before_ok && after_ok {
            return true;
        }
    }
    false
}

/// Classify a manuscript block into treatment hierarchy.
pub fn classify_treatment_block(block: &Block) -> TreatmentSectionKind {
    let text = block.text();
    let t = text.trim();

    match block.kind {
        BlockKind::Heading => {
            if t.starts_with("### ") {
                TreatmentSectionKind::Heading3
            } else if t.starts_with("## ") {
                TreatmentSectionKind::Heading2
            } else {
                TreatmentSectionKind::Heading1
            }
        }
        BlockKind::Section => TreatmentSectionKind::Heading2,
        BlockKind::Shot | BlockKind::Transition => TreatmentSectionKind::Heading3,
        BlockKind::Character => TreatmentSectionKind::Character,
        BlockKind::Parenthetical | BlockKind::Dialogue => TreatmentSectionKind::Blockquote,
        BlockKind::Lyric => TreatmentSectionKind::ListItem,
        BlockKind::Action => {
            if t.starts_with("> ") || (t.starts_with('"') && t.ends_with('"') && t.len() < 120) {
                TreatmentSectionKind::Blockquote
            } else if t.starts_with("- ")
                || t.starts_with("* ")
                || t.starts_with("• ")
                || (t.chars().next().map_or(false, |c| c.is_ascii_digit()) && t.contains(". "))
            {
                TreatmentSectionKind::ListItem
            } else {
                TreatmentSectionKind::Paragraph
            }
        }
    }
}

/// Parse document blocks into a rich-text treatment analysis, cross-referencing Bible entities.
pub fn parse_treatment_doc(
    blocks: &[Block],
    title: &str,
    subtitle: Option<&str>,
    bible_entities: &[Entity],
) -> TreatmentDoc {
    let mut items = Vec::with_capacity(blocks.len());
    let mut total_headings = 0usize;
    let mut total_paragraphs = 0usize;
    let mut total_quotes = 0usize;
    let mut total_lists = 0usize;
    let mut total_words = 0usize;

    for block in blocks {
        let text = block.text();
        let trimmed = text.trim();
        if trimmed.is_empty() {
            continue;
        }

        let kind = classify_treatment_block(block);
        match kind {
            TreatmentSectionKind::Heading1
            | TreatmentSectionKind::Heading2
            | TreatmentSectionKind::Heading3 => total_headings += 1,
            TreatmentSectionKind::Paragraph => total_paragraphs += 1,
            TreatmentSectionKind::Blockquote => total_quotes += 1,
            TreatmentSectionKind::ListItem => total_lists += 1,
            TreatmentSectionKind::Character => total_headings += 1,
        }

        let words = trimmed.split_whitespace().count();
        total_words += words;

        items.push(TreatmentItem {
            id: block.id.clone(),
            kind,
            text: trimmed.to_string(),
            runs: block.runs.clone(),
            block_id: block.id.clone(),
        });
    }

    // Average adult reading speed: ~200-220 words per minute
    let reading_time_mins = if total_words == 0 {
        1
    } else {
        ((total_words as f32) / 200.0).ceil() as usize
    };

    // Cross-reference entities from Project Bible
    let mut mentions = Vec::new();
    for entity in bible_entities {
        let mut count = 0usize;
        let mut matched_blocks = Vec::new();

        for item in &items {
            let mut matched = matches_entity_name(&item.text, &entity.name);
            if !matched {
                for alias in &entity.aliases {
                    if matches_entity_name(&item.text, alias) {
                        matched = true;
                        break;
                    }
                }
            }

            if matched {
                count += 1;
                matched_blocks.push(item.block_id.clone());
            }
        }

        if count > 0 {
            mentions.push(TreatmentEntityMention {
                entity_id: entity.id.clone(),
                entity_name: entity.name.clone(),
                kind: entity.kind.clone(),
                count,
                block_ids: matched_blocks,
            });
        }
    }

    // Sort mentions descending by occurrence frequency
    mentions.sort_by(|a, b| b.count.cmp(&a.count));

    TreatmentDoc {
        title: title.trim().to_string(),
        subtitle: subtitle.map(|s| s.trim().to_string()),
        items,
        total_headings,
        total_paragraphs,
        total_quotes,
        total_lists,
        total_words,
        reading_time_mins,
        mentions,
    }
}

/// Helper to render formatted HTML spans from text runs (bold, italic, underline).
fn render_runs_html(runs: &[Run]) -> String {
    let mut out = String::new();
    for r in runs {
        let escaped = r
            .text
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;");

        let mut span = escaped;
        if r.bold {
            span = format!("<strong>{}</strong>", span);
        }
        if r.italic {
            span = format!("<em>{}</em>", span);
        }
        if r.underline {
            span = format!("<u>{}</u>", span);
        }
        out.push_str(&span);
    }
    out
}

/// Export treatment analysis into a clean, presentation-ready semantic HTML document.
pub fn export_treatment_html(doc: &TreatmentDoc) -> String {
    let mut html = String::new();

    html.push_str("<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n");
    html.push_str("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n");
    html.push_str(&format!("<title>{} - Treatment</title>\n", doc.title));
    html.push_str("<style>\n");
    html.push_str("body { font-family: -apple-system, BlinkMacSystemFont, 'Georgia', serif; max-width: 780px; margin: 40px auto; padding: 0 24px; color: #1e293b; background: #ffffff; line-height: 1.75; font-size: 16px; }\n");
    html.push_str(".treatment-header { border-bottom: 2px solid #0f172a; padding-bottom: 24px; margin-bottom: 32px; text-align: center; }\n");
    html.push_str(".treatment-title { font-size: 2.2rem; font-weight: 800; color: #0f172a; margin-bottom: 8px; letter-spacing: -0.02em; }\n");
    html.push_str(".treatment-sub { font-size: 1.2rem; font-style: italic; color: #475569; margin-bottom: 12px; }\n");
    html.push_str(".treatment-meta { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; font-family: -apple-system, sans-serif; font-weight: 600; }\n");
    html.push_str("h1.treatment-h1 { font-size: 1.6rem; font-weight: 700; color: #0f172a; margin-top: 36px; margin-bottom: 14px; border-bottom: 1px solid #cbd5e1; padding-bottom: 6px; }\n");
    html.push_str("h2.treatment-h2 { font-size: 1.3rem; font-weight: 600; color: #1e293b; margin-top: 28px; margin-bottom: 10px; }\n");
    html.push_str("h3.treatment-h3 { font-size: 1.1rem; font-weight: 600; color: #334155; margin-top: 20px; margin-bottom: 8px; }\n");
    html.push_str(".treatment-p { margin-bottom: 18px; text-align: justify; text-justify: inter-word; color: #334155; }\n");
    html.push_str(".treatment-quote { margin: 24px 0 24px 24px; padding: 12px 20px; border-left: 4px solid #3b82f6; background: #f8fafc; font-style: italic; color: #1e3a8a; border-radius: 0 6px 6px 0; }\n");
    html.push_str(".treatment-ul { margin: 0 0 20px 24px; padding: 0; color: #334155; }\n");
    html.push_str(".treatment-li { margin-bottom: 6px; }\n");
    html.push_str(".treatment-char { background: #f1f5f9; padding: 8px 14px; border-radius: 6px; font-weight: 700; color: #0f172a; margin: 20px 0 10px 0; display: inline-block; text-transform: uppercase; font-size: 0.9rem; letter-spacing: 0.05em; }\n");
    html.push_str(".treatment-bible-box { margin-top: 48px; border-top: 2px dashed #cbd5e1; padding-top: 24px; }\n");
    html.push_str(".treatment-bible-title { font-size: 1.1rem; font-weight: 700; color: #475569; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.05em; }\n");
    html.push_str(".treatment-tag-cloud { display: flex; flex-wrap: wrap; gap: 8px; }\n");
    html.push_str(".treatment-tag { background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; border-radius: 4px; padding: 4px 10px; font-size: 0.8rem; font-weight: 600; }\n");
    html.push_str("</style>\n</head>\n<body>\n");

    html.push_str("<div class=\"treatment-header\">\n");
    html.push_str(&format!("  <div class=\"treatment-title\">{}</div>\n", doc.title));
    if let Some(sub) = &doc.subtitle {
        html.push_str(&format!("  <div class=\"treatment-sub\">{}</div>\n", sub));
    }
    html.push_str(&format!(
        "  <div class=\"treatment-meta\">Words: {} &bull; Reading Time: ~{} min &bull; Sections: {}</div>\n",
        doc.total_words, doc.reading_time_mins, doc.total_headings
    ));
    html.push_str("</div>\n\n<div class=\"treatment-body\">\n");

    let mut in_list = false;

    for item in &doc.items {
        if item.kind == TreatmentSectionKind::ListItem {
            if !in_list {
                html.push_str("<ul class=\"treatment-ul\">\n");
                in_list = true;
            }
            let text_clean = item
                .text
                .trim_start_matches("- ")
                .trim_start_matches("* ")
                .trim_start_matches("• ");
            html.push_str(&format!("  <li class=\"treatment-li\">{}</li>\n", text_clean));
            continue;
        } else if in_list {
            html.push_str("</ul>\n");
            in_list = false;
        }

        match item.kind {
            TreatmentSectionKind::Heading1 => {
                html.push_str(&format!("<h1 class=\"treatment-h1\">{}</h1>\n", item.text));
            }
            TreatmentSectionKind::Heading2 => {
                html.push_str(&format!("<h2 class=\"treatment-h2\">{}</h2>\n", item.text));
            }
            TreatmentSectionKind::Heading3 => {
                html.push_str(&format!("<h3 class=\"treatment-h3\">{}</h3>\n", item.text));
            }
            TreatmentSectionKind::Paragraph => {
                html.push_str(&format!("<p class=\"treatment-p\">{}</p>\n", render_runs_html(&item.runs)));
            }
            TreatmentSectionKind::Blockquote => {
                let text_clean = item.text.trim_start_matches("> ");
                html.push_str(&format!("<blockquote class=\"treatment-quote\">{}</blockquote>\n", text_clean));
            }
            TreatmentSectionKind::Character => {
                html.push_str(&format!("<div class=\"treatment-char\">{}</div>\n", item.text));
            }
            TreatmentSectionKind::ListItem => {}
        }
    }

    if in_list {
        html.push_str("</ul>\n");
    }

    if !doc.mentions.is_empty() {
        html.push_str("<div class=\"treatment-bible-box\">\n");
        html.push_str("  <div class=\"treatment-bible-title\">Project Bible Entities in this Treatment</div>\n");
        html.push_str("  <div class=\"treatment-tag-cloud\">\n");
        for m in &doc.mentions {
            html.push_str(&format!(
                "    <span class=\"treatment-tag\">{}: {} ({}x)</span>\n",
                m.kind.to_uppercase(),
                m.entity_name,
                m.count
            ));
        }
        html.push_str("  </div>\n</div>\n");
    }

    html.push_str("</div>\n</body>\n</html>");
    html
}

/// Export treatment analysis into clean, formatted plain text.
pub fn export_treatment_text(doc: &TreatmentDoc) -> String {
    let mut out = String::new();

    out.push_str(&format!("{}\n", doc.title.to_uppercase()));
    if let Some(sub) = &doc.subtitle {
        out.push_str(&format!("{}\n", sub));
    }
    out.push_str(&format!(
        "WORDS: {} | EST. READING TIME: {} MINS\n",
        doc.total_words, doc.reading_time_mins
    ));
    out.push_str("============================================================\n\n");

    for item in &doc.items {
        match item.kind {
            TreatmentSectionKind::Heading1 => {
                out.push_str(&format!("\n{}\n", item.text.to_uppercase()));
                out.push_str("------------------------------------------------------------\n\n");
            }
            TreatmentSectionKind::Heading2 => {
                out.push_str(&format!("\n## {}\n\n", item.text));
            }
            TreatmentSectionKind::Heading3 => {
                out.push_str(&format!("\n### {}\n\n", item.text));
            }
            TreatmentSectionKind::Paragraph => {
                out.push_str(&format!("{}\n\n", item.text));
            }
            TreatmentSectionKind::Blockquote => {
                let clean = item.text.trim_start_matches("> ");
                out.push_str(&format!("    \"{}\"\n\n", clean));
            }
            TreatmentSectionKind::ListItem => {
                let clean = item
                    .text
                    .trim_start_matches("- ")
                    .trim_start_matches("* ")
                    .trim_start_matches("• ");
                out.push_str(&format!("  * {}\n", clean));
            }
            TreatmentSectionKind::Character => {
                out.push_str(&format!("\n[CHARACTER: {}]\n\n", item.text));
            }
        }
    }

    if !doc.mentions.is_empty() {
        out.push_str("\n============================================================\n");
        out.push_str("PROJECT BIBLE ENTITIES REFERENCED:\n");
        for m in &doc.mentions {
            out.push_str(&format!("- [{}] {} ({} occurrences)\n", m.kind.to_uppercase(), m.entity_name, m.count));
        }
    }

    out
}

/// Export treatment blocks as WordprocessingML (.docx) binary package.
pub fn export_treatment_docx(blocks: &[Block], _title: &str) -> Result<Vec<u8>, String> {
    let profile = Profile::treatment();
    let numbers = crate::numbering::Numbers::new();
    let opts = DocOptions::default();
    let title_page = None;

    let exported = crate::docx::export(blocks, &profile, &numbers, title_page, &opts)
        .map_err(|e| format!("DOCX export error: {:?}", e))?;
    Ok(exported.bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_treatment_blocks() -> Vec<Block> {
        vec![
            Block::new(BlockKind::Heading, "PART ONE: THE OBSIDIAN SHORE"),
            Block::new(
                BlockKind::Action,
                "The northern coastline stretches under an unrelenting arctic squall. Here, Commander Vance established the frontier garrison three winters ago.",
            ),
            Block::new(
                BlockKind::Action,
                "> \"We do not build castles to defy the storms, but to outlast the men who send them.\"",
            ),
            Block::new(BlockKind::Section, "THE RUINS OF AVALON"),
            Block::new(
                BlockKind::Action,
                "Beneath the ice lies the subterranean vault known as the Sunken Cathedral. Inside, Dr. Aris discovered the resonant crystal lattice.",
            ),
            Block::new(BlockKind::Lyric, "- High atmospheric interference prevents satellite reconnaissance"),
            Block::new(BlockKind::Lyric, "- Thermal plumes indicate geothermal activity 400 meters below sea level"),
            Block::new(BlockKind::Lyric, "- Acoustic sensors picked up non-random harmonic pulses"),
            Block::new(BlockKind::Character, "COMMANDER VANCE"),
            Block::new(
                BlockKind::Action,
                "A hardened veteran of the Orbital Insurgency. Her devotion to her crew borders on fanaticism, yet she conceals a terminal radiation sickness.",
            ),
        ]
    }

    fn sample_bible_entities() -> Vec<Entity> {
        vec![
            Entity {
                id: "e_vance".to_string(),
                kind: "character".to_string(),
                name: "Commander Vance".to_string(),
                aliases: vec!["Vance".to_string()],
                description: "Veteran frontier commander.".to_string(),
                ..Default::default()
            },
            Entity {
                id: "e_aris".to_string(),
                kind: "character".to_string(),
                name: "Dr. Aris".to_string(),
                aliases: vec!["Aris".to_string()],
                description: "Lead scientific officer.".to_string(),
                ..Default::default()
            },
            Entity {
                id: "e_avalon".to_string(),
                kind: "location".to_string(),
                name: "Avalon".to_string(),
                aliases: vec!["Sunken Cathedral".to_string()],
                description: "Sunken arctic installation.".to_string(),
                ..Default::default()
            },
            Entity {
                id: "e_unmentioned".to_string(),
                kind: "character".to_string(),
                name: "Captain Thorne".to_string(),
                aliases: Vec::new(),
                description: "Does not appear in this treatment.".to_string(),
                ..Default::default()
            },
        ]
    }

    #[test]
    fn test_parse_treatment_doc_hierarchy_and_mentions() {
        let blocks = sample_treatment_blocks();
        let entities = sample_bible_entities();
        let doc = parse_treatment_doc(&blocks, "The Obsidian Shore", Some("A Series Pitch Treatment"), &entities);

        assert_eq!(doc.title, "The Obsidian Shore");
        assert_eq!(doc.subtitle, Some("A Series Pitch Treatment".to_string()));
        assert_eq!(doc.total_headings, 3); // Heading, Section, Character
        assert_eq!(doc.total_paragraphs, 3);
        assert_eq!(doc.total_quotes, 1);
        assert_eq!(doc.total_lists, 3);
        assert!(doc.total_words > 80);
        assert!(doc.reading_time_mins >= 1);

        // Mentions test
        assert_eq!(doc.mentions.len(), 3); // Vance, Aris, Avalon (Thorne is unmentioned)
        let vance_mention = doc.mentions.iter().find(|m| m.entity_name == "Commander Vance").unwrap();
        assert_eq!(vance_mention.count, 2); // Appears in action block and character block
        assert_eq!(vance_mention.kind, "character");

        let avalon_mention = doc.mentions.iter().find(|m| m.entity_name == "Avalon").unwrap();
        assert_eq!(avalon_mention.count, 2); // Appears as Avalon in section heading and Sunken Cathedral in text
    }

    #[test]
    fn test_export_treatment_html() {
        let blocks = sample_treatment_blocks();
        let entities = sample_bible_entities();
        let doc = parse_treatment_doc(&blocks, "Pitch Bible", Some("Executive Treatment"), &entities);
        let html = export_treatment_html(&doc);

        assert!(html.contains("<!DOCTYPE html>"));
        assert!(html.contains("<title>Pitch Bible - Treatment</title>"));
        assert!(html.contains("<h1 class=\"treatment-h1\">PART ONE: THE OBSIDIAN SHORE</h1>"));
        assert!(html.contains("<h2 class=\"treatment-h2\">THE RUINS OF AVALON</h2>"));
        assert!(html.contains("<blockquote class=\"treatment-quote\">"));
        assert!(html.contains("<ul class=\"treatment-ul\">"));
        assert!(html.contains("<li class=\"treatment-li\">High atmospheric interference"));
        assert!(html.contains("Project Bible Entities in this Treatment"));
        assert!(html.contains("CHARACTER: Commander Vance"));
        assert!(!html.contains("http://"));
        assert!(!html.contains("https://")); // Strict offline rule
    }

    #[test]
    fn test_export_treatment_text() {
        let blocks = sample_treatment_blocks();
        let entities = sample_bible_entities();
        let doc = parse_treatment_doc(&blocks, "Pitch Bible", Some("Executive Treatment"), &entities);
        let txt = export_treatment_text(&doc);

        assert!(txt.contains("PITCH BIBLE"));
        assert!(txt.contains("Executive Treatment"));
        assert!(txt.contains("PART ONE: THE OBSIDIAN SHORE"));
        assert!(txt.contains("## THE RUINS OF AVALON"));
        assert!(txt.contains("  * High atmospheric interference"));
        assert!(txt.contains("PROJECT BIBLE ENTITIES REFERENCED:"));
        assert!(txt.contains("- [CHARACTER] Commander Vance (2 occurrences)"));
    }

    #[test]
    fn test_export_treatment_docx() {
        let blocks = sample_treatment_blocks();
        let docx_bytes = export_treatment_docx(&blocks, "Pitch Bible").expect("DOCX package created");

        // PK\x03\x04 zip signature
        assert!(docx_bytes.len() > 1000);
        assert_eq!(&docx_bytes[0..4], b"PK\x03\x04");
    }
}
