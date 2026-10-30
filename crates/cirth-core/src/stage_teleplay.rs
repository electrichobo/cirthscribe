//! Theatrical Stage Play and Television Multi-Camera Sitcom profiles (M6 Step 3, ROADMAP M6).
//!
//! Provides conversion from standard screenplays into:
//! - Multi-camera teleplay format (lettered scenes `SCENE A`, uppercase dialogue).
//! - Theatrical stage play format (`ACT I, SCENE 1` headings, bracketed stage directions).
//! Also provides profile-specific plain text exports.
//!
//! Conversions run on a copy (Decision A: the original document is kept untouched).
//! They keep each run's bold, italic and underline marks, and they never invent
//! structure: acts come only from explicit act markers written by the author.

use crate::model::{Block, BlockKind, Run};

/// Convert a zero-based scene index into a multi-cam scene letter:
/// 0 -> "A", 1 -> "B", ..., 25 -> "Z", 26 -> "AA", 27 -> "AB", etc.
pub fn to_scene_letter(idx: usize) -> String {
    let mut n = idx;
    let mut s = String::new();
    loop {
        let rem = n % 26;
        s.insert(0, (b'A' + rem as u8) as char);
        if n < 26 {
            break;
        }
        n = (n / 26) - 1;
    }
    s
}

/// Convert a 1-based integer to Roman numerals (e.g. 1 -> "I", 4 -> "IV").
pub fn to_roman(mut num: usize) -> String {
    if num == 0 {
        return "I".to_string();
    }
    let vals = [
        (1000, "M"),
        (900, "CM"),
        (500, "D"),
        (400, "CD"),
        (100, "C"),
        (90, "XC"),
        (50, "L"),
        (40, "XL"),
        (10, "X"),
        (9, "IX"),
        (5, "V"),
        (4, "IV"),
        (1, "I"),
    ];
    let mut out = String::new();
    for (val, sym) in vals {
        while num >= val {
            out.push_str(sym);
            num -= val;
        }
    }
    out
}

/// Parse Roman numerals ("IV" -> 4). Returns None for anything else.
fn from_roman(s: &str) -> Option<usize> {
    if s.is_empty() {
        return None;
    }
    let val = |c: char| match c {
        'I' => Some(1),
        'V' => Some(5),
        'X' => Some(10),
        'L' => Some(50),
        'C' => Some(100),
        'D' => Some(500),
        'M' => Some(1000),
        _ => None,
    };
    let digits: Option<Vec<usize>> = s.chars().map(val).collect();
    let digits = digits?;
    let mut total = 0usize;
    for (i, d) in digits.iter().enumerate() {
        match digits.get(i + 1) {
            Some(next) if next > d => total = total.checked_sub(*d).unwrap_or(0),
            _ => total += d,
        }
    }
    // Subtractive pairs were taken off before their larger partner was added.
    let mut fixed = 0usize;
    let mut i = 0;
    while i < digits.len() {
        if i + 1 < digits.len() && digits[i + 1] > digits[i] {
            fixed += digits[i + 1] - digits[i];
            i += 2;
        } else {
            fixed += digits[i];
            i += 1;
        }
    }
    let _ = total;
    Some(fixed)
}

/// The number in an explicit act marker: "ACT II", "ACT 2", "ACT TWO: THE STORM".
/// Returns None if the text is not an act marker.
pub fn parse_act_marker(text: &str) -> Option<usize> {
    let upper = text.trim().to_uppercase();
    let rest = upper.strip_prefix("ACT")?;
    if !rest.starts_with(char::is_whitespace) {
        return None;
    }
    let token = rest.split_whitespace().next()?;
    let token = token.trim_end_matches([',', ':', '.', '-', ';']);
    if let Ok(n) = token.parse::<usize>() {
        return Some(n);
    }
    let words = ["ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN"];
    if let Some(i) = words.iter().position(|w| *w == token) {
        return Some(i + 1);
    }
    from_roman(token)
}

/// The scene number in a heading such as "ACT II, SCENE 3 - THE STUDY".
fn parse_scene_number(text: &str) -> Option<usize> {
    let upper = text.to_uppercase();
    let at = upper.find("SCENE")?;
    let token = upper[at + "SCENE".len()..].split_whitespace().next()?;
    token.trim_end_matches([',', ':', '.', '-', ';']).parse::<usize>().ok()
}

/// Uppercase every run (any alphabet), keeping bold, italic, underline and
/// screen-only markup.
fn uppercase_runs(runs: &[Run]) -> Vec<Run> {
    runs.iter()
        .map(|r| Run { text: r.text.to_uppercase(), ..r.clone() })
        .collect()
}

/// Put plain `prefix` before the block's own runs (which keep their marks).
fn prefix_runs(runs: &[Run], prefix: String) -> Vec<Run> {
    let mut out = Vec::with_capacity(runs.len() + 1);
    out.push(Run::plain(prefix));
    out.extend(runs.iter().cloned());
    out
}

/// Turn "(text)" into "[text]" (or wrap bare text), keeping each run's marks.
fn bracket_runs(runs: &[Run]) -> Vec<Run> {
    let text: String = runs.iter().map(|r| r.text.as_str()).collect();
    let trimmed = text.trim();
    if trimmed.starts_with('[') && trimmed.ends_with(']') {
        return runs.to_vec();
    }
    if trimmed.starts_with('(') && trimmed.ends_with(')') && trimmed.len() >= 2 {
        let mut out = runs.to_vec();
        if let Some(first) = out.iter_mut().find(|r| !r.text.trim().is_empty()) {
            let lead = first.text.len() - first.text.trim_start().len();
            first.text.replace_range(lead..lead + 1, "[");
        }
        if let Some(last) = out.iter_mut().rev().find(|r| !r.text.trim().is_empty()) {
            let end = last.text.trim_end().len();
            last.text.replace_range(end - 1..end, "]");
        }
        return out;
    }
    let mut out = Vec::with_capacity(runs.len() + 2);
    out.push(Run::plain("["));
    out.extend(runs.iter().cloned());
    out.push(Run::plain("]"));
    out
}

/// Convert a standard screenplay's blocks into Multi-Camera Teleplay format:
/// - Headings become lettered scenes (`SCENE A - INT. APARTMENT - DAY`).
/// - Dialogue text is converted to UPPERCASE (marks kept).
/// - Character cues and actions retain their structural kinds.
pub fn convert_to_teleplay_multicam(blocks: &[Block]) -> Vec<Block> {
    let mut out = Vec::with_capacity(blocks.len());
    let mut scene_idx = 0usize;

    for b in blocks {
        let mut nb = b.clone();
        match b.kind {
            BlockKind::Heading => {
                let letter = to_scene_letter(scene_idx);
                scene_idx += 1;
                let text = b.text();
                let clean = text.trim();
                if clean.to_uppercase().starts_with("SCENE ") {
                    // Already lettered by the author: keep it.
                } else if clean.is_empty() {
                    nb.runs = vec![Run::plain(format!("SCENE {letter}"))];
                } else {
                    nb.runs = prefix_runs(&b.runs, format!("SCENE {letter} - "));
                }
            }
            BlockKind::Dialogue => {
                // Multi-cam teleplays print dialogue in ALL CAPS.
                nb.runs = uppercase_runs(&b.runs);
            }
            _ => {}
        }
        out.push(nb);
    }
    out
}

/// Convert a standard screenplay's blocks into Theatrical Stage Play format:
/// - Headings get act and scene markers (`ACT I, SCENE 1 - LIVING ROOM`).
///   Every scene is in Act I until the author writes an explicit act marker
///   (a section or heading such as `ACT TWO`); acts are never invented.
///   Scene numbers restart at 1 in each act.
/// - Parentheticals are bracketed `[...]`.
pub fn convert_to_stageplay(blocks: &[Block]) -> Vec<Block> {
    let mut out = Vec::with_capacity(blocks.len());
    let mut current_act = 1usize;
    let mut scene_in_act = 0usize;

    for b in blocks {
        let mut nb = b.clone();
        let text = b.text();
        let clean = text.trim();
        match b.kind {
            BlockKind::Section => {
                if let Some(act) = parse_act_marker(clean) {
                    if act != current_act {
                        current_act = act;
                        scene_in_act = 0;
                    }
                }
            }
            BlockKind::Heading => {
                if let Some(act) = parse_act_marker(clean) {
                    // Already marked by the author: keep the text, follow its numbers.
                    if act != current_act {
                        current_act = act;
                        scene_in_act = 0;
                    }
                    scene_in_act = parse_scene_number(clean).unwrap_or(scene_in_act + 1);
                } else {
                    scene_in_act += 1;
                    let marker = format!("ACT {}, SCENE {}", to_roman(current_act), scene_in_act);
                    nb.runs = if clean.is_empty() {
                        vec![Run::plain(marker)]
                    } else {
                        prefix_runs(&b.runs, format!("{marker} - "))
                    };
                }
            }
            BlockKind::Parenthetical => {
                nb.runs = bracket_runs(&b.runs);
            }
            _ => {}
        }
        out.push(nb);
    }
    out
}

/// "A PLAY", "A PLAY IN ONE ACT" or "A PLAY IN THREE ACTS", from the act
/// markers actually present in the blocks.
fn play_subtitle(blocks: &[Block]) -> String {
    let mut acts: Vec<usize> = blocks
        .iter()
        .filter(|b| matches!(b.kind, BlockKind::Heading | BlockKind::Section))
        .filter_map(|b| parse_act_marker(&b.text()))
        .collect();
    acts.sort_unstable();
    acts.dedup();
    let words = ["ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN"];
    match acts.len() {
        0 => "A PLAY".to_string(),
        1 => "A PLAY IN ONE ACT".to_string(),
        n => match words.get(n - 1) {
            Some(w) => format!("A PLAY IN {w} ACTS"),
            None => format!("A PLAY IN {n} ACTS"),
        },
    }
}

/// Export blocks as a standard Multi-Camera Teleplay plain text document.
/// Features:
/// - Centered title.
/// - Lettered scene headers (`SCENE A`).
/// - Centered character cues.
/// - Uppercase dialogue with double line spacing.
pub fn export_teleplay_text(blocks: &[Block], title: &str) -> String {
    let mut out = String::new();
    let pad = |s: &str, left: usize| -> String { format!("{}{}", " ".repeat(left), s) };

    out.push_str(&format!("{}\n", pad(&title.to_uppercase(), 25)));
    out.push_str(&format!("{}\n\n\n", pad("(TELEPLAY / MULTI-CAMERA)", 22)));

    for b in blocks {
        let text = b.text();
        let trimmed = text.trim();
        if trimmed.is_empty() {
            continue;
        }

        match b.kind {
            BlockKind::Heading => {
                out.push_str(&format!("\n\n{}\n\n", trimmed.to_uppercase()));
            }
            BlockKind::Action => {
                out.push_str(&format!("{}\n\n", pad(trimmed, 15)));
            }
            BlockKind::Character => {
                out.push_str(&format!("{}\n", pad(&trimmed.to_uppercase(), 36)));
            }
            BlockKind::Parenthetical => {
                out.push_str(&format!("{}\n", pad(trimmed, 30)));
            }
            BlockKind::Dialogue => {
                // In multi-cam teleplays, dialogue is uppercase and double-spaced.
                let upper = trimmed.to_uppercase();
                for line in upper.lines() {
                    out.push_str(&format!("{}\n\n", pad(line.trim(), 22)));
                }
            }
            BlockKind::Transition => {
                out.push_str(&format!("{}\n\n", pad(&trimmed.to_uppercase(), 55)));
            }
            _ => {
                out.push_str(&format!("{}\n\n", pad(trimmed, 15)));
            }
        }
    }

    out
}

/// Export blocks as a standard Theatrical Stage Play plain text document.
/// Features:
/// - Centered title and a subtitle counting the explicit acts.
/// - Act and Scene headings.
/// - Centered character cues (col 35).
/// - Indented dialogue (col 20).
/// - Bracketed stage directions `[...]`.
pub fn export_stageplay_text(blocks: &[Block], title: &str) -> String {
    let mut out = String::new();
    let pad = |s: &str, left: usize| -> String { format!("{}{}", " ".repeat(left), s) };

    out.push_str(&format!("{}\n", pad(&title.to_uppercase(), 28)));
    out.push_str(&format!("{}\n\n\n", pad(&play_subtitle(blocks), 26)));

    for b in blocks {
        let text = b.text();
        let trimmed = text.trim();
        if trimmed.is_empty() {
            continue;
        }

        match b.kind {
            BlockKind::Heading | BlockKind::Section => {
                out.push_str(&format!("\n\n{}\n\n", pad(&trimmed.to_uppercase(), 20)));
            }
            BlockKind::Action => {
                // Stage directions are indented and in brackets.
                if trimmed.starts_with('[') && trimmed.ends_with(']') {
                    out.push_str(&format!("{}\n\n", pad(trimmed, 15)));
                } else {
                    out.push_str(&format!("{}\n\n", pad(&format!("[{trimmed}]"), 15)));
                }
            }
            BlockKind::Character => {
                out.push_str(&format!("{}\n", pad(&trimmed.to_uppercase(), 35)));
            }
            BlockKind::Parenthetical => {
                let bracketed = if trimmed.starts_with('[') && trimmed.ends_with(']') {
                    trimmed.to_string()
                } else if trimmed.starts_with('(') && trimmed.ends_with(')') {
                    format!("[{}]", trimmed[1..trimmed.len() - 1].trim())
                } else {
                    format!("[{trimmed}]")
                };
                out.push_str(&format!("{}\n", pad(&bracketed, 28)));
            }
            BlockKind::Dialogue => {
                out.push_str(&format!("{}\n\n", pad(trimmed, 20)));
            }
            BlockKind::Transition => {
                out.push_str(&format!("{}\n\n", pad(&trimmed.to_uppercase(), 50)));
            }
            _ => {
                out.push_str(&format!("{}\n\n", pad(trimmed, 15)));
            }
        }
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::new_id;

    // All test text is original (fixtures rule).
    fn block(kind: BlockKind, text: &str) -> Block {
        Block {
            id: new_id(),
            kind,
            runs: vec![Run::plain(text)],
            scene_id: if kind == BlockKind::Heading { Some(new_id()) } else { None },
            dual: false,
            break_before: false,
        }
    }

    #[test]
    fn test_to_scene_letter() {
        assert_eq!(to_scene_letter(0), "A");
        assert_eq!(to_scene_letter(1), "B");
        assert_eq!(to_scene_letter(25), "Z");
        assert_eq!(to_scene_letter(26), "AA");
        assert_eq!(to_scene_letter(27), "AB");
    }

    #[test]
    fn test_roman_numerals_both_ways() {
        for (n, r) in [(1, "I"), (2, "II"), (3, "III"), (4, "IV"), (5, "V"), (9, "IX"), (10, "X"), (14, "XIV"), (40, "XL")] {
            assert_eq!(to_roman(n), r);
            assert_eq!(from_roman(r), Some(n), "{r}");
        }
        assert_eq!(from_roman("KITCHEN"), None);
    }

    #[test]
    fn test_parse_act_marker() {
        assert_eq!(parse_act_marker("ACT II"), Some(2));
        assert_eq!(parse_act_marker("Act 3: The Flood"), Some(3));
        assert_eq!(parse_act_marker("ACT TWO"), Some(2));
        assert_eq!(parse_act_marker("ACT I, SCENE 4 - THE PIER"), Some(1));
        assert_eq!(parse_act_marker("ACTION FIGURES ON A SHELF"), None);
        assert_eq!(parse_act_marker("INT. HARBOR DINER - DAY"), None);
    }

    #[test]
    fn test_convert_to_teleplay_multicam_letters_scenes_and_uppercases_any_alphabet() {
        let blocks = vec![
            block(BlockKind::Heading, "INT. HARBOR DINER - DAY"),
            block(BlockKind::Action, "Maren drags a dripping canoe paddle past the counter."),
            block(BlockKind::Character, "MAREN"),
            block(BlockKind::Dialogue, "Somebody parked a canoe in the walk-in freezer."),
            block(BlockKind::Heading, "INT. MAREN'S KITCHEN - LATER"),
            block(BlockKind::Character, "TOBIAS"),
            block(BlockKind::Dialogue, "Où est le café, Zoë? Straße."),
        ];

        let converted = convert_to_teleplay_multicam(&blocks);
        assert_eq!(converted.len(), 7);
        assert_eq!(converted[0].text(), "SCENE A - INT. HARBOR DINER - DAY");
        assert_eq!(converted[1].text(), blocks[1].text(), "action is untouched");
        assert_eq!(converted[3].text(), "SOMEBODY PARKED A CANOE IN THE WALK-IN FREEZER.");
        assert_eq!(converted[4].text(), "SCENE B - INT. MAREN'S KITCHEN - LATER");
        assert_eq!(converted[6].text(), "OÙ EST LE CAFÉ, ZOË? STRASSE.");
    }

    #[test]
    fn test_teleplay_conversion_keeps_marks() {
        let mut line = block(BlockKind::Dialogue, "");
        line.runs = vec![
            Run::plain("I said "),
            Run { text: "never".into(), bold: true, italic: true, ..Run::plain("") },
            Run::plain(" again."),
        ];
        let mut heading = block(BlockKind::Heading, "");
        heading.runs = vec![Run { text: "INT. LOFT - NIGHT".into(), underline: true, ..Run::plain("") }];

        let converted = convert_to_teleplay_multicam(&[heading, line]);
        assert_eq!(converted[0].text(), "SCENE A - INT. LOFT - NIGHT");
        assert!(converted[0].runs.iter().any(|r| r.underline && r.text == "INT. LOFT - NIGHT"));
        assert_eq!(converted[1].text(), "I SAID NEVER AGAIN.");
        let marked = converted[1].runs.iter().find(|r| r.text == "NEVER").expect("marked run kept");
        assert!(marked.bold && marked.italic);
    }

    #[test]
    fn test_convert_to_stageplay_never_invents_acts() {
        let mut blocks = Vec::new();
        for i in 1..=7 {
            blocks.push(block(BlockKind::Heading, &format!("A ROOFTOP GARDEN, EVENING {i}")));
            blocks.push(block(BlockKind::Action, "Wind rattles the tomato cages."));
        }
        let converted = convert_to_stageplay(&blocks);
        let headings: Vec<String> = converted.iter().filter(|b| b.kind == BlockKind::Heading).map(|b| b.text()).collect();
        assert_eq!(headings.len(), 7);
        for (i, h) in headings.iter().enumerate() {
            assert!(h.starts_with(&format!("ACT I, SCENE {} - ", i + 1)), "{h}");
        }
        assert_eq!(play_subtitle(&converted), "A PLAY IN ONE ACT");
    }

    #[test]
    fn test_convert_to_stageplay_follows_explicit_act_markers_and_brackets_directions() {
        let blocks = vec![
            block(BlockKind::Heading, "A ROOFTOP GARDEN AT DUSK"),
            block(BlockKind::Character, "ODILE"),
            block(BlockKind::Parenthetical, "(setting down the watering can)"),
            block(BlockKind::Dialogue, "You promised me one honest answer."),
            block(BlockKind::Heading, "THE STAIRWELL"),
            block(BlockKind::Section, "ACT TWO"),
            block(BlockKind::Heading, "THE SAME GARDEN, MORNING"),
            block(BlockKind::Parenthetical, "quietly"),
        ];

        let converted = convert_to_stageplay(&blocks);
        assert_eq!(converted[0].text(), "ACT I, SCENE 1 - A ROOFTOP GARDEN AT DUSK");
        assert_eq!(converted[2].text(), "[setting down the watering can]");
        assert_eq!(converted[3].text(), "You promised me one honest answer.");
        assert_eq!(converted[4].text(), "ACT I, SCENE 2 - THE STAIRWELL");
        assert_eq!(converted[5].text(), "ACT TWO", "the author's marker is kept as written");
        assert_eq!(converted[6].text(), "ACT II, SCENE 1 - THE SAME GARDEN, MORNING");
        assert_eq!(converted[7].text(), "[quietly]");
        assert_eq!(play_subtitle(&converted), "A PLAY IN TWO ACTS");
    }

    #[test]
    fn test_bracketing_keeps_marks() {
        let mut p = block(BlockKind::Parenthetical, "");
        p.runs = vec![Run::plain("("), Run { text: "very".into(), italic: true, ..Run::plain("") }, Run::plain(" softly)")];
        let converted = convert_to_stageplay(&[p]);
        assert_eq!(converted[0].text(), "[very softly]");
        assert!(converted[0].runs.iter().any(|r| r.italic && r.text == "very"));
    }

    #[test]
    fn test_export_teleplay_and_stageplay_text() {
        let blocks = vec![
            block(BlockKind::Heading, "SCENE A - LIGHTHOUSE STAIRS - NIGHT"),
            block(BlockKind::Character, "PERPETUA"),
            block(BlockKind::Dialogue, "Count the steps with me, Émile."),
        ];

        let tele_txt = export_teleplay_text(&blocks, "The Lantern Keepers");
        assert!(tele_txt.contains("THE LANTERN KEEPERS"));
        assert!(tele_txt.contains("SCENE A - LIGHTHOUSE STAIRS - NIGHT"));
        assert!(tele_txt.contains("COUNT THE STEPS WITH ME, ÉMILE."));

        let stage_txt = export_stageplay_text(&blocks, "The Lantern Keepers");
        assert!(stage_txt.contains("THE LANTERN KEEPERS"));
        assert!(stage_txt.contains("A PLAY\n"), "no act markers: no act count is claimed");
        assert!(stage_txt.contains("Count the steps with me, Émile."));

        let staged = convert_to_stageplay(&[block(BlockKind::Heading, "THE LANTERN ROOM")]);
        assert!(export_stageplay_text(&staged, "The Lantern Keepers").contains("A PLAY IN ONE ACT"));
    }
}
