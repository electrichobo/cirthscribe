//! Fountain (plain-text screenplay interchange, https://fountain.io) import
//! and export. Both directions report what Fountain or Kolbítar cannot carry;
//! import never drops text silently.
//!
//! Export: blocks are separated by blank lines, except inside a speech (cue,
//! parentheticals, dialogue and lyrics are consecutive lines). Elements that
//! plain Fountain rules would read back as something else are forced (`!`
//! action, `@` character, `.` heading, `>` transition). Bold, italic and
//! underline become `**`, `*` and `_`; colour and highlight are dropped
//! (on-screen markup). Shots have no Fountain element and become action.
//!
//! Import: the title page (`Key: value` lines before the first blank line),
//! scene headings, action, characters (with `^` dual dialogue),
//! parentheticals, dialogue, lyrics (`~`), transitions, sections (`#`),
//! page breaks (`===`) and emphasis. Lines inside one paragraph or speech
//! are joined with a space, because a block holds no line breaks. Notes
//! (`[[ ]]`) and boneyard (`/* */`) are kept as visible text so nothing is
//! lost, and reported. Scene numbers (`#12A#`) are removed and listed
//! (numbering comes in a later step). Centred text and synopses become action.

use crate::model::{Block, BlockKind, Document, Run};
use crate::title::TitlePage;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct Exported {
    pub text: String,
    /// What Fountain could not keep (shown to the user after export).
    pub notes: Vec<String>,
}

#[derive(Debug)]
pub struct Imported {
    pub document: Document,
    pub title_page: TitlePage,
    /// Scene numbers that came with the file (scene id, number): the app
    /// locks them so they are kept.
    pub scene_numbers: Vec<(String, String)>,
    /// What was changed or could not be kept (shown to the user after import).
    pub notes: Vec<String>,
}

// ---------------------------------------------------------------- export --

fn is_heading_text(t: &str) -> bool {
    let u = t.to_uppercase();
    ["INT.", "EXT.", "EST.", "INT/EXT", "INT./EXT", "I/E", "INT ", "EXT ", "EST "].iter().any(|p| u.starts_with(p))
}

fn is_caps(t: &str) -> bool {
    t.chars().any(char::is_alphabetic) && !t.chars().any(char::is_lowercase)
}

/// Escape Fountain emphasis characters in literal text.
fn escape(t: &str) -> String {
    let mut out = String::with_capacity(t.len());
    for c in t.chars() {
        if matches!(c, '*' | '_' | '\\') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// Runs to Fountain text with emphasis markers hugging the words.
fn runs_text(runs: &[Run], dropped_markup: &mut usize) -> String {
    let mut out = String::new();
    for r in runs {
        if r.color.is_some() || r.highlight.is_some() {
            *dropped_markup += 1;
        }
        let body = r.text.trim();
        if body.is_empty() || !(r.bold || r.italic || r.underline) {
            out.push_str(&escape(&r.text));
            continue;
        }
        let lead = &r.text[..r.text.len() - r.text.trim_start().len()];
        let trail = &r.text[r.text.trim_end().len()..];
        let stars = match (r.bold, r.italic) {
            (true, true) => "***",
            (true, false) => "**",
            (false, true) => "*",
            _ => "",
        };
        let u = if r.underline { "_" } else { "" };
        out.push_str(lead);
        out.push_str(&format!("{u}{stars}{}{stars}{u}", escape(body)));
        out.push_str(trail);
    }
    out
}

fn title_page_text(tp: &TitlePage) -> String {
    let mut out = String::new();
    let mut field = |key: &str, value: &str| {
        let lines: Vec<&str> = value.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
        match lines.len() {
            0 => {}
            1 => out.push_str(&format!("{key}: {}\n", lines[0])),
            _ => {
                out.push_str(&format!("{key}:\n"));
                for l in lines {
                    out.push_str(&format!("   {l}\n"));
                }
            }
        }
    };
    field("Title", &tp.title);
    field("Credit", &tp.credit);
    field("Author", &tp.authors);
    field("Source", &tp.source);
    field("Revision", &tp.draft_label);
    field("Draft date", &tp.draft_date);
    field("WGA", &tp.wga);
    field("Contact", &tp.contact);
    field("Notes", &tp.notes);
    out
}

pub fn export(blocks: &[Block], title_page: &TitlePage, numbers: &crate::numbering::Numbers) -> Exported {
    let mut out = String::new();
    let mut notes = Vec::new();
    let (mut shots, mut markup, mut omitted) = (0usize, 0usize, 0usize);
    if !title_page.is_empty() {
        out.push_str(&title_page_text(title_page));
        out.push('\n');
    }
    let mut prev: Option<BlockKind> = None;
    for b in blocks {
        let text = runs_text(&b.runs, &mut markup);
        let plain = b.text();
        let in_speech = matches!(b.kind, BlockKind::Parenthetical | BlockKind::Dialogue | BlockKind::Lyric) && prev.is_some_and(|p| p.is_speech());
        if b.break_before {
            if !out.is_empty() && !out.ends_with("\n\n") {
                out.push('\n');
            }
            out.push_str("===\n\n");
        } else if !in_speech && !out.is_empty() && !out.ends_with("\n\n") {
            out.push('\n');
        }
        let starts_special = |t: &str| t.starts_with(['!', '@', '.', '~', '>', '=', '#', '[']) || t.trim().is_empty();
        let line = match b.kind {
            BlockKind::Heading => {
                let h = if is_heading_text(&plain) && !plain.starts_with('.') { text } else { format!(".{text}") };
                match b.scene_id.as_ref().and_then(|id| numbers.get(id)) {
                    Some(n) => {
                        omitted += n.omitted as usize;
                        format!("{h} #{}#", n.number)
                    }
                    None => h,
                }
            }
            BlockKind::Character => {
                let cue = if is_caps(&plain) && !starts_special(&plain) { text } else { format!("@{text}") };
                if b.dual { format!("{cue} ^") } else { cue }
            }
            BlockKind::Parenthetical => {
                let t = plain.trim();
                if t.starts_with('(') && t.ends_with(')') { text } else { format!("({text})") }
            }
            BlockKind::Dialogue => {
                // A dialogue line that looks like a parenthetical would be read as one.
                if plain.trim_start().starts_with('(') { format!("!{text}") } else { text }
            }
            BlockKind::Lyric => format!("~{text}"),
            BlockKind::Transition => {
                if is_caps(&plain) && plain.trim_end().ends_with("TO:") { text } else { format!(">{text}") }
            }
            BlockKind::Section => format!("# {text}"),
            BlockKind::Action | BlockKind::Shot => {
                if b.kind == BlockKind::Shot {
                    shots += 1;
                }
                // Plain action that Fountain would read as something else is forced.
                let ambiguous = is_heading_text(&plain) || is_caps(&plain) || starts_special(&plain);
                if ambiguous { format!("!{text}") } else { text }
            }
        };
        out.push_str(&line);
        out.push('\n');
        prev = Some(b.kind);
    }
    if shots > 0 {
        notes.push(format!("{shots} shot{} exported as action (Fountain has no shot element).", if shots == 1 { "" } else { "s" }));
    }
    if markup > 0 {
        notes.push(format!("Text colour and highlight left out ({markup} marked run{}): they are on-screen markup only.", if markup == 1 { "" } else { "s" }));
    }
    if omitted > 0 {
        notes.push(format!("{omitted} omitted scene{} written with their text and number (Fountain has no omitted scenes).", if omitted == 1 { "" } else { "s" }));
    }
    notes.push("Fountain keeps the text, element types, emphasis, dual dialogue, page breaks and the title page; it has no layout, so pages are decided by the app that opens it.".into());
    Exported { text: out, notes }
}

// ---------------------------------------------------------------- import --

/// Parse one line's emphasis into runs. Markers only count when a matching
/// closing marker follows on the same line; `\` escapes a character.
fn parse_runs(line: &str) -> Vec<Run> {
    let chars: Vec<char> = line.chars().collect();
    // Which marker positions are real: find balanced pairs.
    let mut tokens: Vec<(usize, &'static str)> = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '\\' {
            i += 2;
            continue;
        }
        // `/*` and `*/` are boneyard delimiters, not emphasis.
        let slash_next = |j: usize| (j > 0 && chars[j - 1] == '/') || chars.get(j + 1) == Some(&'/');
        if chars[i] == '*' && slash_next(i) {
            i += 1;
        } else if chars[i] == '*' {
            let n = chars[i..].iter().take_while(|&&c| c == '*').count().min(3);
            tokens.push((i, ["*", "**", "***"][n - 1]));
            i += n;
        } else if chars[i] == '_' {
            tokens.push((i, "_"));
            i += 1;
        } else {
            i += 1;
        }
    }
    let mut real = vec![false; tokens.len()];
    for a in 0..tokens.len() {
        if real[a] {
            continue;
        }
        if let Some(b) = (a + 1..tokens.len()).find(|&b| !real[b] && tokens[b].1 == tokens[a].1) {
            real[a] = true;
            real[b] = true;
        }
    }
    let marker_at: std::collections::HashMap<usize, &str> = tokens.iter().zip(&real).filter(|(_, r)| **r).map(|(t, _)| (t.0, t.1)).collect();
    let (mut bold, mut italic, mut underline) = (false, false, false);
    let mut runs: Vec<Run> = Vec::new();
    let mut cur = String::new();
    let flush = |cur: &mut String, runs: &mut Vec<Run>, b: bool, it: bool, u: bool| {
        if !cur.is_empty() {
            runs.push(Run { text: std::mem::take(cur), bold: b, italic: it, underline: u, color: None, highlight: None });
        }
    };
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '\\' && i + 1 < chars.len() {
            cur.push(chars[i + 1]);
            i += 2;
            continue;
        }
        if let Some(m) = marker_at.get(&i) {
            flush(&mut cur, &mut runs, bold, italic, underline);
            match *m {
                "***" => {
                    bold = !bold;
                    italic = !italic;
                }
                "**" => bold = !bold,
                "*" => italic = !italic,
                _ => underline = !underline,
            }
            i += m.len();
            continue;
        }
        cur.push(chars[i]);
        i += 1;
    }
    flush(&mut cur, &mut runs, bold, italic, underline);
    if runs.is_empty() {
        runs.push(Run::plain(""));
    }
    runs
}

/// Join lines of one paragraph (no line breaks in a block), keeping emphasis.
fn joined_runs(lines: &[&str]) -> Vec<Run> {
    let mut runs: Vec<Run> = Vec::new();
    for (i, l) in lines.iter().enumerate() {
        if i > 0 {
            runs.push(Run::plain(" "));
        }
        runs.extend(parse_runs(l.trim()));
    }
    // Merge neighbours with the same marks.
    let mut merged: Vec<Run> = Vec::new();
    for r in runs.into_iter().filter(|r| !r.text.is_empty()) {
        match merged.last_mut() {
            Some(m) if m.bold == r.bold && m.italic == r.italic && m.underline == r.underline => m.text.push_str(&r.text),
            _ => merged.push(r),
        }
    }
    if merged.is_empty() {
        merged.push(Run::plain(""));
    }
    merged
}

fn block(kind: BlockKind, runs: Vec<Run>) -> Block {
    let mut b = Block::new(kind, "");
    b.runs = runs;
    b
}

fn parse_title_page(lines: &[&str], notes: &mut Vec<String>) -> TitlePage {
    let mut tp = TitlePage::default();
    let mut fields: Vec<(String, Vec<String>)> = Vec::new();
    for l in lines {
        let indented = l.starts_with("   ") || l.starts_with('\t');
        if !indented {
            if let Some((k, v)) = l.split_once(':') {
                fields.push((k.trim().to_lowercase(), if v.trim().is_empty() { vec![] } else { vec![v.trim().to_string()] }));
                continue;
            }
        }
        if let Some(f) = fields.last_mut() {
            f.1.push(l.trim().to_string());
        }
    }
    let mut extra = Vec::new();
    for (k, v) in fields {
        let v = v.join("\n");
        let slot = match k.as_str() {
            "title" => &mut tp.title,
            "credit" => &mut tp.credit,
            "author" | "authors" => &mut tp.authors,
            "source" => &mut tp.source,
            "draft date" | "date" => &mut tp.draft_date,
            "revision" | "draft" => &mut tp.draft_label,
            "wga" | "wga registration" => &mut tp.wga,
            "contact" => &mut tp.contact,
            "notes" => &mut tp.notes,
            _ => {
                extra.push(format!("{}: {v}", k));
                continue;
            }
        };
        // Fountain titles may carry emphasis markers; keep the words.
        *slot = v.replace(['*', '_'], "");
    }
    if !extra.is_empty() {
        notes.push(format!("Title page fields Kolbítar has no slot for were added to its notes: {}.", extra.iter().map(|e| e.split(':').next().unwrap_or("")).collect::<Vec<_>>().join(", ")));
        if !tp.notes.is_empty() {
            tp.notes.push('\n');
        }
        tp.notes.push_str(&extra.join("\n"));
    }
    tp
}

pub fn import(source: &str, fallback_title: &str) -> Imported {
    let text = source.trim_start_matches('\u{feff}').replace("\r\n", "\n").replace('\r', "\n");
    let all: Vec<&str> = text.split('\n').collect();
    let mut notes = Vec::new();

    // Title page: key: value lines up to the first blank line.
    let mut start = 0;
    while start < all.len() && all[start].trim().is_empty() {
        start += 1;
    }
    let looks_like_key = |l: &str| l.split_once(':').is_some_and(|(k, _)| !k.is_empty() && k.len() < 30 && k.chars().all(|c| c.is_alphabetic() || c == ' '));
    let mut title_page = TitlePage::default();
    if start < all.len() && looks_like_key(all[start]) && !is_heading_text(all[start]) {
        let end = (start..all.len()).find(|&i| all[i].trim().is_empty()).unwrap_or(all.len());
        title_page = parse_title_page(&all[start..end], &mut notes);
        start = end;
    }
    let lines = &all[start..];

    let blank = |i: usize| i >= lines.len() || lines[i].trim().is_empty();
    let mut blocks: Vec<Block> = Vec::new();
    let mut pending_break = false;
    let (mut joined, mut centred, mut synopses, mut scene_numbers) = (0usize, 0usize, 0usize, Vec::new());
    let (mut fountain_notes, mut boneyard) = (0usize, 0usize);
    let push = |mut b: Block, pending_break: &mut bool, blocks: &mut Vec<Block>| {
        b.break_before = std::mem::take(pending_break);
        blocks.push(b);
    };
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i].trim_end();
        let t = line.trim();
        if t.is_empty() {
            i += 1;
            continue;
        }
        fountain_notes += t.matches("[[").count();
        boneyard += t.matches("/*").count();
        let prev_blank = i == 0 || blank(i - 1);
        // Page break.
        if t.len() >= 3 && t.chars().all(|c| c == '=') {
            pending_break = true;
            i += 1;
            continue;
        }
        // Section.
        if t.starts_with('#') {
            push(block(BlockKind::Section, parse_runs(t.trim_start_matches('#').trim())), &mut pending_break, &mut blocks);
            i += 1;
            continue;
        }
        // Synopsis: kept as action.
        if t.starts_with('=') {
            synopses += 1;
            push(block(BlockKind::Action, parse_runs(t.trim_start_matches('=').trim())), &mut pending_break, &mut blocks);
            i += 1;
            continue;
        }
        // Scene heading (forced with a single leading dot).
        let forced_heading = t.starts_with('.') && !t.starts_with("..");
        if prev_blank && (forced_heading || is_heading_text(t)) {
            let mut h = if forced_heading { &t[1..] } else { t }.trim().to_string();
            let mut number = None;
            if let Some(start) = h.rfind(" #").filter(|_| h.ends_with('#')) {
                number = Some(h[start + 2..h.len() - 1].to_string());
                h.truncate(start);
            }
            let heading = block(BlockKind::Heading, parse_runs(h.trim()));
            if let (Some(n), Some(id)) = (number, heading.scene_id.clone()) {
                scene_numbers.push((id, n));
            }
            push(heading, &mut pending_break, &mut blocks);
            i += 1;
            continue;
        }
        // Centred text: kept as action.
        if t.starts_with('>') && t.ends_with('<') {
            centred += 1;
            push(block(BlockKind::Action, parse_runs(t[1..t.len() - 1].trim())), &mut pending_break, &mut blocks);
            i += 1;
            continue;
        }
        // Transition (forced with >, or caps ending in TO: between blank lines).
        if t.starts_with('>') || (prev_blank && blank(i + 1) && is_caps(t) && t.ends_with("TO:")) {
            push(block(BlockKind::Transition, parse_runs(t.trim_start_matches('>').trim())), &mut pending_break, &mut blocks);
            i += 1;
            continue;
        }
        // Lyric line outside a speech.
        if t.starts_with('~') {
            push(block(BlockKind::Lyric, parse_runs(t[1..].trim())), &mut pending_break, &mut blocks);
            i += 1;
            continue;
        }
        // Character cue: forced with @, or caps with dialogue on the next line.
        let forced_cue = t.starts_with('@');
        let cue_text = t.trim_end_matches('^').trim_end();
        let caps_cue = !t.starts_with('!') && is_caps(cue_text.split('(').next().unwrap_or(cue_text)) && !is_heading_text(t);
        if prev_blank && !blank(i + 1) && (forced_cue || caps_cue) {
            let dual = t.ends_with('^');
            let name = cue_text.trim_start_matches('@').trim();
            let mut cue = block(BlockKind::Character, parse_runs(name));
            cue.dual = dual;
            push(cue, &mut pending_break, &mut blocks);
            i += 1;
            let mut dialogue: Vec<&str> = Vec::new();
            let flush = |dialogue: &mut Vec<&str>, blocks: &mut Vec<Block>, joined: &mut usize| {
                if !dialogue.is_empty() {
                    *joined += (dialogue.len() > 1) as usize;
                    blocks.push(block(BlockKind::Dialogue, joined_runs(dialogue)));
                    dialogue.clear();
                }
            };
            while !blank(i) {
                let l = lines[i].trim();
                fountain_notes += l.matches("[[").count();
                boneyard += l.matches("/*").count();
                if l.starts_with('(') && l.ends_with(')') {
                    flush(&mut dialogue, &mut blocks, &mut joined);
                    blocks.push(block(BlockKind::Parenthetical, parse_runs(l)));
                } else if let Some(lyric) = l.strip_prefix('~') {
                    flush(&mut dialogue, &mut blocks, &mut joined);
                    blocks.push(block(BlockKind::Lyric, parse_runs(lyric.trim())));
                } else {
                    dialogue.push(l.strip_prefix('!').unwrap_or(l));
                }
                i += 1;
            }
            flush(&mut dialogue, &mut blocks, &mut joined);
            continue;
        }
        // Action: the paragraph up to the next blank line.
        let mut para = vec![t.strip_prefix('!').unwrap_or(t)];
        i += 1;
        while !blank(i) && !lines[i].trim().starts_with("===") {
            let l = lines[i].trim();
            fountain_notes += l.matches("[[").count();
            boneyard += l.matches("/*").count();
            para.push(l.strip_prefix('!').unwrap_or(l));
            i += 1;
        }
        joined += (para.len() > 1) as usize;
        push(block(BlockKind::Action, joined_runs(&para)), &mut pending_break, &mut blocks);
    }
    if blocks.is_empty() {
        blocks.push(Block::new(BlockKind::Heading, ""));
    }
    let plural = |n: usize| if n == 1 { "" } else { "s" };
    if !scene_numbers.is_empty() {
        notes.push(format!("{} scene number{} kept and locked ({}); scenes without one were given A/B numbers.", scene_numbers.len(), plural(scene_numbers.len()), scene_numbers.iter().map(|(_, n)| n.as_str()).collect::<Vec<_>>().join(", ")));
    }
    if joined > 0 {
        notes.push(format!("{joined} paragraph{} or speech{} had line breaks; their lines were joined with spaces.", plural(joined), if joined == 1 { "" } else { "es" }));
    }
    if centred > 0 {
        notes.push(format!("{centred} centred line{} (> <) imported as action.", plural(centred)));
    }
    if synopses > 0 {
        notes.push(format!("{synopses} synopsis line{} (=) imported as action.", plural(synopses)));
    }
    if fountain_notes > 0 {
        notes.push(format!("{fountain_notes} note{} ([[ ]]) kept as visible text so nothing is lost; comments come in a later step.", plural(fountain_notes)));
    }
    if boneyard > 0 {
        notes.push(format!("{boneyard} boneyard section{} (/* */) kept as visible text so nothing is lost.", plural(boneyard)));
    }
    let title = if title_page.title.trim().is_empty() { fallback_title.to_string() } else { title_page.title.lines().next().unwrap_or("").trim().to_string() };
    Imported { document: Document { title, version: 0, blocks }, title_page, scene_numbers, notes }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// (kind, text, bold/italic/underline per run, dual, break) without ids.
    fn shape(blocks: &[Block]) -> Vec<(String, Vec<(String, bool, bool, bool)>, bool, bool)> {
        blocks
            .iter()
            .map(|b| {
                let kind = if b.kind == BlockKind::Shot { BlockKind::Action } else { b.kind };
                let runs = joined_runs_of(&b.runs);
                (kind.as_str().to_string(), runs, b.dual, b.break_before)
            })
            .collect()
    }

    /// Merge neighbouring runs with the same marks (export/import may split differently).
    fn joined_runs_of(runs: &[Run]) -> Vec<(String, bool, bool, bool)> {
        let mut out: Vec<(String, bool, bool, bool)> = Vec::new();
        for r in runs.iter().filter(|r| !r.text.is_empty()) {
            match out.last_mut() {
                Some(l) if (l.1, l.2, l.3) == (r.bold, r.italic, r.underline) => l.0.push_str(&r.text),
                _ => out.push((r.text.clone(), r.bold, r.italic, r.underline)),
            }
        }
        out
    }

    #[test]
    fn fixtures_round_trip_through_fountain() {
        for f in [crate::fixtures::unicode_marks(), crate::fixtures::page_boundaries(), crate::fixtures::long_script(20)] {
            let doc = f.to_document().unwrap();
            let tp = TitlePage { title: "ROUND TRIP".into(), authors: "Jared Hoy\nA. N. Other".into(), contact: "jared@example.invalid".into(), wga: "1234567".into(), ..Default::default() };
            let out = export(&doc.blocks, &tp, &Default::default());
            let back = import(&out.text, "fallback");
            assert_eq!(shape(&back.document.blocks), shape(&doc.blocks), "{}", doc.title);
            assert_eq!(back.title_page, tp);
            assert!(back.notes.is_empty(), "nothing to report on a round trip: {:?}", back.notes);
        }
    }

    #[test]
    fn imports_a_hand_written_fountain_file() {
        let src = "Title: **SALT AND IRON**\nCredit: Written by\nAuthor: Jared Hoy\nDraft date: 1 May 2026\nContact:\n   jared@example.invalid\n   555 0100\nProducer: Nobody\n\n\
INT. FORGE - NIGHT #12A#\n\nSparks fly. *Somewhere* a bell rings.\nIt rings again.\n\n\
MARA\n(quietly)\nHand me the **tongs**.\nNow.\n\nBRAM ^\nNo.\n\n\
.ROOFTOP\n\n> THE END <\n\nCUT TO:\n\n===\n\n# Act two\n\n= The deal goes wrong.\n\n@McCLANE\nYippee [[check this]].\n\n~Sing along\n\n!LOUD NOISES\n\n/* old scene */\n";
        let r = import(src, "fallback");
        let kinds: Vec<&str> = r.document.blocks.iter().map(|b| b.kind.as_str()).collect();
        assert_eq!(
            kinds,
            ["heading", "action", "character", "parenthetical", "dialogue", "character", "dialogue", "heading", "action", "transition", "section", "action", "character", "dialogue", "lyric", "action", "action"]
        );
        let b = &r.document.blocks;
        assert_eq!(b[0].text(), "INT. FORGE - NIGHT");
        assert_eq!(b[1].text(), "Sparks fly. Somewhere a bell rings. It rings again.");
        assert!(b[1].runs.iter().any(|x| x.italic && x.text == "Somewhere"));
        assert_eq!(b[4].text(), "Hand me the tongs. Now.");
        assert!(b[4].runs.iter().any(|x| x.bold && x.text == "tongs"));
        assert!(b[5].dual && b[5].text() == "BRAM");
        assert_eq!(b[7].text(), "ROOFTOP");
        assert!(b[10].break_before && b[10].text() == "Act two");
        assert_eq!(b[12].text(), "McCLANE");
        assert_eq!(b[13].text(), "Yippee [[check this]].", "notes kept as text");
        assert_eq!(b[15].text(), "LOUD NOISES");
        assert_eq!(b[16].text(), "/* old scene */", "boneyard kept as text");
        assert_eq!(r.title_page.title, "SALT AND IRON");
        assert_eq!(r.title_page.contact, "jared@example.invalid\n555 0100");
        assert!(r.title_page.notes.contains("producer: Nobody"));
        assert_eq!(r.document.title, "SALT AND IRON");
        let all = r.notes.join(" ");
        assert_eq!(r.scene_numbers.iter().map(|(_, n)| n.as_str()).collect::<Vec<_>>(), ["12A"], "scene number kept");
        for expected in ["kept and locked", "joined", "centred", "synopsis", "note", "boneyard", "producer"] {
            assert!(all.contains(expected), "report mentions {expected}: {all}");
        }
    }

    #[test]
    fn export_forces_what_would_be_misread_and_reports_losses() {
        let mut caps_action = Block::new(BlockKind::Action, "BANG");
        caps_action.runs[0].color = Some("red".into());
        let blocks = vec![
            Block::new(BlockKind::Heading, "ROOFTOP"),
            caps_action,
            Block::new(BlockKind::Character, "McClane"),
            Block::new(BlockKind::Dialogue, "(not a parenthetical) really."),
            Block::new(BlockKind::Transition, "Fade out."),
            Block::new(BlockKind::Shot, "ANGLE ON THE DOOR"),
            Block::new(BlockKind::Action, "Price: 5 * 3 = 15_000"),
        ];
        let out = export(&blocks, &TitlePage::default(), &Default::default());
        for line in [".ROOFTOP", "!BANG", "@McClane", "!(not a parenthetical) really.", ">Fade out.", "!ANGLE ON THE DOOR", "Price: 5 \\* 3 = 15\\_000"] {
            assert!(out.text.lines().any(|l| l == line), "{line:?} in:\n{}", out.text);
        }
        assert!(out.notes.iter().any(|n| n.contains("shot")) && out.notes.iter().any(|n| n.contains("colour")));
        let back = import(&out.text, "x");
        assert_eq!(shape(&back.document.blocks), shape(&blocks), "forced elements read back as written");
    }

    #[test]
    fn scene_numbers_round_trip() {
        use crate::numbering::{Numbers, SceneNumber};
        let doc = crate::fixtures::page_boundaries().to_document().unwrap();
        let mut numbers = Numbers::new();
        let ids: Vec<String> = doc.blocks.iter().filter_map(|b| b.scene_id.clone()).collect();
        for (i, id) in ids.iter().enumerate() {
            numbers.insert(id.clone(), SceneNumber { scene_id: id.clone(), number: if i == 1 { "1A".into() } else { (i + 1).to_string() }, omitted: i == 2 });
        }
        let out = export(&doc.blocks, &TitlePage::default(), &numbers);
        assert!(out.notes.iter().any(|n| n.contains("omitted")), "omitted scenes reported: {:?}", out.notes);
        let back = import(&out.text, "x");
        let got: Vec<String> = back.scene_numbers.iter().map(|(_, n)| n.clone()).collect();
        let want: Vec<String> = ids.iter().map(|id| numbers[id].number.clone()).collect();
        assert_eq!(got, want);
        // Numbers belong to the imported headings, in order.
        let heading_ids: Vec<String> = back.document.blocks.iter().filter_map(|b| b.scene_id.clone()).collect();
        assert_eq!(back.scene_numbers.iter().map(|(id, _)| id.clone()).collect::<Vec<_>>(), heading_ids);
        assert_eq!(back.document.blocks.len(), doc.blocks.len(), "omitted scenes keep their text in interchange");
    }
}