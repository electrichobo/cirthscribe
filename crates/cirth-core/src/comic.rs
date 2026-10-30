//! Comic book and graphic novel script analysis and exports (M6 step 2, ROADMAP M6).
//!
//! Provides explicit Page and Panel hierarchy parsing, automatic panel counting
//! per page, speech balloon, caption and SFX identification, continuity warnings,
//! and specialized comic script exports in Plain Text and HTML.

use crate::model::{Block, BlockKind, Id, Run};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ComicLetteringKind {
    Balloon,
    Caption,
    Sfx,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ComicLetteringItem {
    pub kind: ComicLetteringKind,
    pub speaker: Option<String>,
    pub parenthetical: Option<String>,
    pub text: String,
    pub block_id: Id,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ComicPanel {
    pub panel_num: usize,
    pub header_text: String,
    pub header_block_id: Id,
    pub descriptions: Vec<String>,
    pub lettering: Vec<ComicLetteringItem>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ComicPage {
    pub page_num: usize,
    pub header_text: String,
    pub header_block_id: Id,
    pub declared_panels: Option<usize>,
    pub panels: Vec<ComicPanel>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ComicScriptAnalysis {
    pub pages: Vec<ComicPage>,
    pub total_pages: usize,
    pub total_panels: usize,
    pub avg_panels_per_page: f32,
    pub total_balloons: usize,
    pub total_captions: usize,
    pub total_sfx: usize,
    pub warnings: Vec<String>,
}

/// Extract numbers or words (e.g. "ONE" -> 1, "TWO" -> 2) from page/panel headings.
fn parse_number_word(s: &str) -> Option<usize> {
    let s_clean = s.trim().to_ascii_uppercase();
    if let Ok(n) = s_clean.parse::<usize>() {
        return Some(n);
    }
    match s_clean.as_str() {
        "ONE" | "FIRST" => Some(1),
        "TWO" | "SECOND" => Some(2),
        "THREE" | "THIRD" => Some(3),
        "FOUR" | "FOURTH" => Some(4),
        "FIVE" | "FIFTH" => Some(5),
        "SIX" | "SIXTH" => Some(6),
        "SEVEN" | "SEVENTH" => Some(7),
        "EIGHT" | "EIGHTH" => Some(8),
        "NINE" | "NINTH" => Some(9),
        "TEN" | "TENTH" => Some(10),
        "ELEVEN" => Some(11),
        "TWELVE" => Some(12),
        "THIRTEEN" => Some(13),
        "FOURTEEN" => Some(14),
        "FIFTEEN" => Some(15),
        "SIXTEEN" => Some(16),
        "SEVENTEEN" => Some(17),
        "EIGHTEEN" => Some(18),
        "NINETEEN" => Some(19),
        "TWENTY" => Some(20),
        _ => None,
    }
}

/// Detect if block heading is a page header (e.g. "PAGE 1", "PAGE ONE (4 PANELS)", "PAGE 2 - SPLASH").
pub fn is_page_header(b: &Block) -> bool {
    let t = b.text().trim().to_ascii_uppercase();
    (b.kind == BlockKind::Heading || b.kind == BlockKind::Section) && t.starts_with("PAGE")
}

/// Detect if block is a panel header (e.g. "PANEL 1", "PANEL ONE", "PANEL 2 - WIDE SHOT").
pub fn is_panel_header(b: &Block) -> bool {
    let t = b.text().trim().to_ascii_uppercase();
    (b.kind == BlockKind::Heading || b.kind == BlockKind::Section || b.kind == BlockKind::Shot)
        && t.starts_with("PANEL")
}

/// Parse declared panels from a page heading, e.g. "PAGE ONE (4 PANELS)" -> Some(4).
fn extract_declared_panels(heading: &str) -> Option<usize> {
    if let Some(open) = heading.find('(') {
        if let Some(close) = heading.find(')') {
            if close > open {
                let inside = &heading[open + 1..close];
                for word in inside.split_whitespace() {
                    if let Some(n) = parse_number_word(word) {
                        return Some(n);
                    }
                }
            }
        }
    }
    None
}

/// Parse page number from a page heading, e.g. "PAGE 3" or "PAGE THREE (5 PANELS)".
fn extract_page_number(heading: &str, fallback_idx: usize) -> usize {
    let upper = heading.to_ascii_uppercase();
    if let Some(rest) = upper.strip_prefix("PAGE") {
        let first_token = rest.split(['(', '-', ':', ' ']).find(|w| !w.trim().is_empty());
        if let Some(tok) = first_token {
            if let Some(n) = parse_number_word(tok.trim()) {
                return n;
            }
        }
    }
    fallback_idx
}

/// Parse panel number from a panel heading, e.g. "PANEL 2" or "PANEL TWO".
fn extract_panel_number(heading: &str, fallback_idx: usize) -> usize {
    let upper = heading.to_ascii_uppercase();
    if let Some(rest) = upper.strip_prefix("PANEL") {
        let first_token = rest.split(['(', '-', ':', '.', ' ']).find(|w| !w.trim().is_empty());
        if let Some(tok) = first_token {
            if let Some(n) = parse_number_word(tok.trim()) {
                return n;
            }
        }
    }
    fallback_idx
}

/// Parse a screenplay or comic document's blocks into a structured `ComicScriptAnalysis`.
pub fn parse_comic_script(blocks: &[Block]) -> ComicScriptAnalysis {
    let mut pages: Vec<ComicPage> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();

    let mut cur_page: Option<ComicPage> = None;
    let mut cur_panel: Option<ComicPanel> = None;
    let mut pending_speaker: Option<String> = None;
    let mut pending_paren: Option<String> = None;

    let flush_panel = |cur_panel: &mut Option<ComicPanel>, cur_page: &mut Option<ComicPage>| {
        if let Some(panel) = cur_panel.take() {
            if let Some(page) = cur_page.as_mut() {
                page.panels.push(panel);
            }
        }
    };

    let flush_page = |cur_page: &mut Option<ComicPage>, pages: &mut Vec<ComicPage>| {
        if let Some(page) = cur_page.take() {
            pages.push(page);
        }
    };

    let mut auto_page_idx = 1usize;

    for b in blocks {
        let text = b.text();
        let trimmed = text.trim();
        let upper = trimmed.to_ascii_uppercase();

        if is_page_header(b) {
            flush_panel(&mut cur_panel, &mut cur_page);
            flush_page(&mut cur_page, &mut pages);

            let page_num = extract_page_number(trimmed, auto_page_idx);
            let declared = extract_declared_panels(trimmed);
            auto_page_idx = page_num + 1;

            cur_page = Some(ComicPage {
                page_num,
                header_text: trimmed.to_string(),
                header_block_id: b.id.clone(),
                declared_panels: declared,
                panels: Vec::new(),
            });
            continue;
        }

        if is_panel_header(b) {
            // Ensure there is an active page
            if cur_page.is_none() {
                cur_page = Some(ComicPage {
                    page_num: auto_page_idx,
                    header_text: format!("PAGE {}", auto_page_idx),
                    header_block_id: b.id.clone(),
                    declared_panels: None,
                    panels: Vec::new(),
                });
                auto_page_idx += 1;
            }

            flush_panel(&mut cur_panel, &mut cur_page);

            let page_panels_count = cur_page.as_ref().map(|p| p.panels.len()).unwrap_or(0);
            let panel_num = extract_panel_number(trimmed, page_panels_count + 1);

            cur_panel = Some(ComicPanel {
                panel_num,
                header_text: trimmed.to_string(),
                header_block_id: b.id.clone(),
                descriptions: Vec::new(),
                lettering: Vec::new(),
            });
            continue;
        }

        // Lettering & descriptions within active panel (or default panel if not yet opened)
        if cur_panel.is_none() {
            if cur_page.is_none() {
                cur_page = Some(ComicPage {
                    page_num: auto_page_idx,
                    header_text: format!("PAGE {}", auto_page_idx),
                    header_block_id: b.id.clone(),
                    declared_panels: None,
                    panels: Vec::new(),
                });
                auto_page_idx += 1;
            }
            cur_panel = Some(ComicPanel {
                panel_num: 1,
                header_text: "PANEL 1".to_string(),
                header_block_id: b.id.clone(),
                descriptions: Vec::new(),
                lettering: Vec::new(),
            });
        }

        let panel = cur_panel.as_mut().unwrap();

        match b.kind {
            BlockKind::Character => {
                if upper.starts_with("CAPTION") {
                    let cap_text = trimmed["CAPTION".len()..].trim_start_matches(':').trim();
                    if !cap_text.is_empty() {
                        panel.lettering.push(ComicLetteringItem {
                            kind: ComicLetteringKind::Caption,
                            speaker: None,
                            parenthetical: None,
                            text: cap_text.to_string(),
                            block_id: b.id.clone(),
                        });
                        pending_speaker = None;
                    } else {
                        pending_speaker = Some("CAPTION".to_string());
                    }
                } else if upper.starts_with("SFX") || upper.starts_with("SOUND EFFECT") {
                    let offset = if upper.starts_with("SOUND EFFECT") { "SOUND EFFECT".len() } else { "SFX".len() };
                    let sfx_text = trimmed[offset..].trim_start_matches(':').trim();
                    if !sfx_text.is_empty() {
                        panel.lettering.push(ComicLetteringItem {
                            kind: ComicLetteringKind::Sfx,
                            speaker: None,
                            parenthetical: None,
                            text: sfx_text.to_string(),
                            block_id: b.id.clone(),
                        });
                        pending_speaker = None;
                    } else {
                        pending_speaker = Some("SFX".to_string());
                    }
                } else {
                    pending_speaker = Some(trimmed.to_string());
                }
            }
            BlockKind::Parenthetical => {
                pending_paren = Some(trimmed.to_string());
            }
            BlockKind::Dialogue => {
                let speaker = pending_speaker.take();
                let paren = pending_paren.take();
                if let Some(spk) = &speaker {
                    if spk == "CAPTION" {
                        panel.lettering.push(ComicLetteringItem {
                            kind: ComicLetteringKind::Caption,
                            speaker: None,
                            parenthetical: paren,
                            text: trimmed.to_string(),
                            block_id: b.id.clone(),
                        });
                        continue;
                    } else if spk == "SFX" {
                        panel.lettering.push(ComicLetteringItem {
                            kind: ComicLetteringKind::Sfx,
                            speaker: None,
                            parenthetical: paren,
                            text: trimmed.to_string(),
                            block_id: b.id.clone(),
                        });
                        continue;
                    }
                }
                panel.lettering.push(ComicLetteringItem {
                    kind: ComicLetteringKind::Balloon,
                    speaker,
                    parenthetical: paren,
                    text: trimmed.to_string(),
                    block_id: b.id.clone(),
                });
            }
            BlockKind::Lyric => {
                // Lyric blocks in comic profile represent sound effects or narrative captions
                if upper.starts_with("SFX") || upper.contains('!') {
                    panel.lettering.push(ComicLetteringItem {
                        kind: ComicLetteringKind::Sfx,
                        speaker: None,
                        parenthetical: None,
                        text: trimmed.to_string(),
                        block_id: b.id.clone(),
                    });
                } else {
                    panel.lettering.push(ComicLetteringItem {
                        kind: ComicLetteringKind::Caption,
                        speaker: None,
                        parenthetical: None,
                        text: trimmed.to_string(),
                        block_id: b.id.clone(),
                    });
                }
            }
            _ => {
                // Action, shot, description
                if !trimmed.is_empty() {
                    panel.descriptions.push(trimmed.to_string());
                }
            }
        }
    }

    flush_panel(&mut cur_panel, &mut cur_page);
    flush_page(&mut cur_page, &mut pages);

    // Compute metrics and validate sequential panel continuity
    let total_pages = pages.len();
    let mut total_panels = 0usize;
    let mut total_balloons = 0usize;
    let mut total_captions = 0usize;
    let mut total_sfx = 0usize;

    for (p_idx, page) in pages.iter().enumerate() {
        let expected_page_num = p_idx + 1;
        if page.page_num != expected_page_num {
            warnings.push(format!("Page heading '{}' indicates page {}, expected page {}", page.header_text, page.page_num, expected_page_num));
        }

        let actual_panel_count = page.panels.len();
        total_panels += actual_panel_count;

        if let Some(declared) = page.declared_panels {
            if declared != actual_panel_count {
                warnings.push(format!("Page {}: heading declares {} panels, but {} panels found", page.page_num, declared, actual_panel_count));
            }
        }

        // Check panel number sequence
        for (idx, panel) in page.panels.iter().enumerate() {
            let expected_panel_num = idx + 1;
            if panel.panel_num != expected_panel_num {
                warnings.push(format!("Page {}, Panel {}: numbered as {}, expected {}", page.page_num, idx + 1, panel.panel_num, expected_panel_num));
            }

            for item in &panel.lettering {
                match item.kind {
                    ComicLetteringKind::Balloon => total_balloons += 1,
                    ComicLetteringKind::Caption => total_captions += 1,
                    ComicLetteringKind::Sfx => total_sfx += 1,
                }
            }
        }
    }

    let avg_panels_per_page = if total_pages > 0 {
        total_panels as f32 / total_pages as f32
    } else {
        0.0
    };

    ComicScriptAnalysis {
        pages,
        total_pages,
        total_panels,
        avg_panels_per_page,
        total_balloons,
        total_captions,
        total_sfx,
        warnings,
    }
}

/// Automatically renumber comic panels and reconcile page headings with accurate panel counts.
pub fn renumber_comic_panels(blocks: &[Block]) -> Vec<Block> {
    let mut out = Vec::with_capacity(blocks.len());
    let mut cur_page_idx = 0usize;
    let mut cur_panel_idx = 0usize;

    // First pass: count panels per page
    let mut panels_per_page: Vec<usize> = Vec::new();
    let mut cur_p_count = 0usize;
    let mut seen_page = false;

    for b in blocks {
        if is_page_header(b) {
            if seen_page {
                panels_per_page.push(cur_p_count);
                cur_p_count = 0;
            }
            seen_page = true;
        } else if is_panel_header(b) {
            cur_p_count += 1;
        }
    }
    if seen_page {
        panels_per_page.push(cur_p_count);
    }

    // Second pass: rewrite page and panel headers
    let mut p_idx = 0usize;

    for b in blocks {
        if is_page_header(b) {
            cur_page_idx += 1;
            cur_panel_idx = 0;

            let count = panels_per_page.get(p_idx).copied().unwrap_or(0);
            p_idx += 1;

            let panel_word = if count == 1 { "PANEL" } else { "PANELS" };
            let new_page_text = format!("PAGE {} ({} {})", cur_page_idx, count, panel_word);

            let mut updated = b.clone();
            updated.runs = vec![Run::plain(new_page_text)];
            out.push(updated);
        } else if is_panel_header(b) {
            cur_panel_idx += 1;
            let mut updated = b.clone();
            updated.runs = vec![Run::plain(format!("PANEL {}", cur_panel_idx))];
            out.push(updated);
        } else {
            out.push(b.clone());
        }
    }

    out
}

/// Export a parsed comic script into clean, industry-standard Plain Text format.
pub fn export_comic_text(analysis: &ComicScriptAnalysis, title: &str) -> String {
    let mut out = String::new();
    out.push_str(&format!("TITLE: {}\n", title.trim()));
    out.push_str(&format!("TOTAL PAGES: {}\n", analysis.total_pages));
    out.push_str(&format!("TOTAL PANELS: {}\n", analysis.total_panels));
    out.push_str("------------------------------------------------------------\n\n");

    for page in &analysis.pages {
        out.push_str(&format!("{}\n\n", page.header_text.to_ascii_uppercase()));

        for panel in &page.panels {
            out.push_str(&format!("{}\n", panel.header_text.to_ascii_uppercase()));

            for desc in &panel.descriptions {
                out.push_str(&format!("{}\n", desc));
            }
            if !panel.descriptions.is_empty() {
                out.push('\n');
            }

            for item in &panel.lettering {
                match item.kind {
                    ComicLetteringKind::Balloon => {
                        if let Some(speaker) = &item.speaker {
                            out.push_str(&format!("    {}\n", speaker.to_ascii_uppercase()));
                        }
                        if let Some(paren) = &item.parenthetical {
                            out.push_str(&format!("    {}\n", paren));
                        }
                        out.push_str(&format!("    {}\n\n", item.text));
                    }
                    ComicLetteringKind::Caption => {
                        out.push_str(&format!("    CAPTION: {}\n\n", item.text));
                    }
                    ComicLetteringKind::Sfx => {
                        out.push_str(&format!("    SFX: {}\n\n", item.text));
                    }
                }
            }

            out.push('\n');
        }

        out.push_str("============================================================\n\n");
    }

    out
}

/// Export a parsed comic script into a self-contained, printable HTML document.
pub fn export_comic_html(analysis: &ComicScriptAnalysis, title: &str) -> String {
    let mut html = String::new();
    html.push_str("<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n");
    html.push_str(&format!("<title>{} - Comic Script</title>\n", title));
    html.push_str("<style>\n");
    html.push_str("body { font-family: 'Courier Prime', Courier, monospace; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #111; line-height: 1.5; }\n");
    html.push_str(".comic-title { text-align: center; font-size: 20pt; font-weight: bold; margin-bottom: 30px; text-transform: uppercase; border-bottom: 2px solid #222; padding-bottom: 15px; }\n");
    html.push_str(".comic-page { margin-bottom: 60px; page-break-after: always; }\n");
    html.push_str(".comic-page-header { font-size: 15pt; font-weight: bold; background: #eee; padding: 8px 12px; margin-bottom: 20px; border-left: 6px solid #222; text-transform: uppercase; }\n");
    html.push_str(".comic-panel { margin: 20px 0 25px 20px; padding: 12px 18px; border-left: 3px solid #666; }\n");
    html.push_str(".comic-panel-header { font-weight: bold; font-size: 12pt; margin-bottom: 10px; text-transform: uppercase; color: #000; }\n");
    html.push_str(".comic-desc { margin-bottom: 12px; color: #333; }\n");
    html.push_str(".comic-balloon { margin-left: 40px; margin-bottom: 12px; }\n");
    html.push_str(".comic-speaker { font-weight: bold; text-transform: uppercase; }\n");
    html.push_str(".comic-paren { font-style: italic; color: #555; }\n");
    html.push_str(".comic-caption { margin-left: 40px; margin-bottom: 12px; font-weight: 500; font-style: italic; color: #222; border-left: 3px solid #ffcc00; padding-left: 8px; }\n");
    html.push_str(".comic-sfx { margin-left: 40px; margin-bottom: 12px; font-weight: 900; letter-spacing: 2px; color: #d00; text-transform: uppercase; }\n");
    html.push_str("</style>\n</head>\n<body>\n");

    html.push_str(&format!("<div class=\"comic-title\">{}<br><small style=\"font-size:11pt;font-weight:normal;\">Total Pages: {} | Total Panels: {} | Avg Panels/Page: {:.1}</small></div>\n", title, analysis.total_pages, analysis.total_panels, analysis.avg_panels_per_page));

    for page in &analysis.pages {
        html.push_str("<div class=\"comic-page\">\n");
        html.push_str(&format!("<div class=\"comic-page-header\">{}</div>\n", page.header_text));

        for panel in &page.panels {
            html.push_str("<div class=\"comic-panel\">\n");
            html.push_str(&format!("<div class=\"comic-panel-header\">{}</div>\n", panel.header_text));

            for desc in &panel.descriptions {
                html.push_str(&format!("<div class=\"comic-desc\">{}</div>\n", desc));
            }

            for item in &panel.lettering {
                match item.kind {
                    ComicLetteringKind::Balloon => {
                        html.push_str("<div class=\"comic-balloon\">\n");
                        if let Some(spk) = &item.speaker {
                            html.push_str(&format!("<div class=\"comic-speaker\">{}</div>\n", spk));
                        }
                        if let Some(paren) = &item.parenthetical {
                            html.push_str(&format!("<div class=\"comic-paren\">{}</div>\n", paren));
                        }
                        html.push_str(&format!("<div class=\"comic-text\">{}</div>\n", item.text));
                        html.push_str("</div>\n");
                    }
                    ComicLetteringKind::Caption => {
                        html.push_str(&format!("<div class=\"comic-caption\"><strong>CAPTION:</strong> {}</div>\n", item.text));
                    }
                    ComicLetteringKind::Sfx => {
                        html.push_str(&format!("<div class=\"comic-sfx\">SFX: {}</div>\n", item.text));
                    }
                }
            }

            html.push_str("</div>\n");
        }

        html.push_str("</div>\n");
    }

    html.push_str("</body>\n</html>");
    html
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_comic_script() -> Vec<Block> {
        vec![
            Block::new(BlockKind::Heading, "PAGE ONE (3 PANELS)"),
            Block::new(BlockKind::Section, "PANEL 1"),
            Block::new(BlockKind::Action, "Wide shot of a futuristic metropolis bathed in neon rain."),
            Block::new(BlockKind::Character, "CAPTION:"),
            Block::new(BlockKind::Dialogue, "2088. The grid never sleeps."),
            Block::new(BlockKind::Character, "KIRA"),
            Block::new(BlockKind::Parenthetical, "(over comms)"),
            Block::new(BlockKind::Dialogue, "Target sighted on the 40th floor."),
            Block::new(BlockKind::Lyric, "SFX: SKRRRRT!"),

            Block::new(BlockKind::Section, "PANEL 2"),
            Block::new(BlockKind::Action, "Close-up of Kira's mechanical eye scanning the perimeter."),
            Block::new(BlockKind::Character, "KIRA"),
            Block::new(BlockKind::Dialogue, "Moving in."),

            Block::new(BlockKind::Section, "PANEL 3"),
            Block::new(BlockKind::Action, "Kira crashes through the reinforced glass window."),
            Block::new(BlockKind::Lyric, "SFX: SHATTER-KRAK!"),

            Block::new(BlockKind::Heading, "PAGE TWO (1 PANEL)"),
            Block::new(BlockKind::Section, "PANEL 1 - FULL SPLASH"),
            Block::new(BlockKind::Action, "Spectacular full-page splash of the neon laboratory."),
            Block::new(BlockKind::Character, "CYBORG GUARD"),
            Block::new(BlockKind::Dialogue, "Intruder!"),
        ]
    }

    #[test]
    fn test_parse_comic_script_extracts_pages_panels_and_lettering() {
        let blocks = sample_comic_script();
        let analysis = parse_comic_script(&blocks);

        assert_eq!(analysis.total_pages, 2);
        assert_eq!(analysis.total_panels, 4);
        assert_eq!(analysis.pages[0].panels.len(), 3);
        assert_eq!(analysis.pages[1].panels.len(), 1);
        assert_eq!(analysis.total_balloons, 3);
        assert_eq!(analysis.total_captions, 1);
        assert_eq!(analysis.total_sfx, 2);
        assert!(analysis.warnings.is_empty(), "No warnings for well-formed script: {:?}", analysis.warnings);

        let p1 = &analysis.pages[0].panels[0];
        assert_eq!(p1.descriptions[0], "Wide shot of a futuristic metropolis bathed in neon rain.");
        assert_eq!(p1.lettering.len(), 3);
        assert_eq!(p1.lettering[0].kind, ComicLetteringKind::Caption);
        assert_eq!(p1.lettering[1].kind, ComicLetteringKind::Balloon);
        assert_eq!(p1.lettering[1].speaker.as_deref(), Some("KIRA"));
        assert_eq!(p1.lettering[1].parenthetical.as_deref(), Some("(over comms)"));
        assert_eq!(p1.lettering[2].kind, ComicLetteringKind::Sfx);
    }

    #[test]
    fn test_panel_counting_and_discrepancy_warnings() {
        let bad_blocks = vec![
            Block::new(BlockKind::Heading, "PAGE ONE (5 PANELS)"), // Declares 5, but only has 2
            Block::new(BlockKind::Section, "PANEL 1"),
            Block::new(BlockKind::Action, "Action."),
            Block::new(BlockKind::Section, "PANEL 3"), // Skips 2
            Block::new(BlockKind::Action, "Action 2."),
        ];

        let analysis = parse_comic_script(&bad_blocks);
        assert_eq!(analysis.total_pages, 1);
        assert_eq!(analysis.total_panels, 2);
        assert!(!analysis.warnings.is_empty());
        assert!(analysis.warnings.iter().any(|w| w.contains("declares 5 panels, but 2 panels found")));
        assert!(analysis.warnings.iter().any(|w| w.contains("numbered as 3, expected 2")));
    }

    #[test]
    fn test_renumber_comic_panels_corrects_panel_sequence() {
        let disordered = vec![
            Block::new(BlockKind::Heading, "PAGE ONE (WRONG COUNT)"),
            Block::new(BlockKind::Section, "PANEL 4"),
            Block::new(BlockKind::Action, "Intro."),
            Block::new(BlockKind::Section, "PANEL 9"),
            Block::new(BlockKind::Action, "Next."),
        ];

        let fixed = renumber_comic_panels(&disordered);
        assert_eq!(fixed[0].text(), "PAGE 1 (2 PANELS)");
        assert_eq!(fixed[1].text(), "PANEL 1");
        assert_eq!(fixed[3].text(), "PANEL 2");

        let fixed_analysis = parse_comic_script(&fixed);
        assert_eq!(fixed_analysis.total_panels, 2);
        assert!(fixed_analysis.warnings.is_empty());
    }

    #[test]
    fn test_comic_script_text_and_html_exports() {
        let blocks = sample_comic_script();
        let analysis = parse_comic_script(&blocks);

        let text = export_comic_text(&analysis, "NEON GHOST");
        assert!(text.contains("TITLE: NEON GHOST"));
        assert!(text.contains("PAGE ONE (3 PANELS)"));
        assert!(text.contains("PANEL 1"));
        assert!(text.contains("KIRA"));
        assert!(text.contains("CAPTION: 2088. The grid never sleeps."));
        assert!(text.contains("SFX: SKRRRRT!"));

        let html = export_comic_html(&analysis, "NEON GHOST");
        assert!(html.contains("<!DOCTYPE html>"));
        assert!(html.contains("comic-page-header"));
        assert!(html.contains("comic-balloon"));
        assert!(html.contains("comic-sfx"));
        assert!(html.contains("NEON GHOST"));
    }
}
