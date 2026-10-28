//! Final Draft (.fdx) import and export: the XML `FinalDraft` document's
//! `Content` paragraphs, emphasis, dual dialogue, page breaks and the title
//! page. Built from the publicly documented structure of .fdx files; not
//! yet checked against Final Draft itself (docs/testing MANUAL_CHECKS N23).
//!
//! Only paragraph types known to be standard are written: Scene Heading,
//! Action, Character, Parenthetical, Dialogue, Transition, Shot, General.
//! Sections become General and lyrics become Dialogue, and the export report
//! says so; nothing new is invented in the XML. Colour and highlight (screen
//! markup) are left out.
//!
//! Import maps those types back, reads `Style` (Bold, Italic, Underline),
//! `StartsNewPage`, `DualDialogue`, and the title page by position (centred
//! lines: title, credit, authors; left: contact; right: notes). Unknown
//! paragraph types become action with their text kept; scene numbers, script
//! notes and other elements Kolbítar cannot use yet are listed in the report.

use crate::model::{Block, BlockKind, Document, Run};
use crate::title::TitlePage;
use quick_xml::events::{BytesStart, Event};
use quick_xml::{Reader, XmlVersion};
use std::collections::BTreeMap;

pub use crate::fountain::Exported;

#[derive(Debug)]
pub struct Imported {
    pub document: Document,
    pub title_page: TitlePage,
    pub notes: Vec<String>,
}

// ---------------------------------------------------------------- export --

fn esc(t: &str) -> String {
    quick_xml::escape::escape(t).into_owned()
}

fn fdx_type(kind: BlockKind) -> &'static str {
    match kind {
        BlockKind::Heading => "Scene Heading",
        BlockKind::Action => "Action",
        BlockKind::Character => "Character",
        BlockKind::Parenthetical => "Parenthetical",
        BlockKind::Dialogue | BlockKind::Lyric => "Dialogue",
        BlockKind::Transition => "Transition",
        BlockKind::Shot => "Shot",
        BlockKind::Section => "General",
    }
}

fn text_runs(runs: &[Run], markup: &mut usize) -> String {
    let mut out = String::new();
    for r in runs.iter().filter(|r| !r.text.is_empty()) {
        if r.color.is_some() || r.highlight.is_some() {
            *markup += 1;
        }
        let style: Vec<&str> = [(r.bold, "Bold"), (r.italic, "Italic"), (r.underline, "Underline")].iter().filter(|(on, _)| *on).map(|(_, s)| *s).collect();
        if style.is_empty() {
            out.push_str(&format!("<Text>{}</Text>", esc(&r.text)));
        } else {
            out.push_str(&format!("<Text Style=\"{}\">{}</Text>", style.join("+"), esc(&r.text)));
        }
    }
    if out.is_empty() {
        out.push_str("<Text></Text>");
    }
    out
}

fn paragraph(b: &Block, markup: &mut usize) -> String {
    let page = if b.break_before { " StartsNewPage=\"Yes\"" } else { "" };
    format!("    <Paragraph Type=\"{}\"{page}>{}</Paragraph>\n", fdx_type(b.kind), text_runs(&b.runs, markup))
}

fn title_page_xml(tp: &TitlePage) -> String {
    let mut out = String::from("  <TitlePage>\n    <Content>\n");
    let mut para = |align: &str, text: &str| out.push_str(&format!("      <Paragraph Alignment=\"{align}\"><Text>{}</Text></Paragraph>\n", esc(text)));
    let lines = |t: &str| t.lines().map(str::trim).filter(|l| !l.is_empty()).map(String::from).collect::<Vec<_>>();
    for _ in 0..12 {
        para("Center", "");
    }
    for (i, block) in [&tp.title, &tp.credit, &tp.authors, &tp.source].iter().enumerate() {
        let ls = lines(block);
        if ls.is_empty() {
            continue;
        }
        if i > 0 {
            para("Center", "");
        }
        for l in ls {
            para("Center", &l);
        }
    }
    for _ in 0..12 {
        para("Left", "");
    }
    for l in lines(&tp.contact) {
        para("Left", &l);
    }
    let wga = tp.wga.trim();
    let wga = if wga.is_empty() || wga.to_uppercase().contains("WGA") { wga.to_string() } else { format!("WGA Registration No. {wga}") };
    for block in [&tp.draft_label, &tp.draft_date, &wga, &tp.notes] {
        for l in lines(block) {
            para("Right", &l);
        }
    }
    out.push_str("    </Content>\n  </TitlePage>\n");
    out
}

pub fn export(blocks: &[Block], title_page: &TitlePage) -> Exported {
    let mut out = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"no\" ?>\n<FinalDraft DocumentType=\"Script\" Template=\"No\" Version=\"5\">\n  <Content>\n");
    let (mut markup, mut sections, mut lyrics) = (0usize, 0usize, 0usize);
    let mut i = 0;
    while i < blocks.len() {
        let b = &blocks[i];
        sections += (b.kind == BlockKind::Section) as usize;
        lyrics += (b.kind == BlockKind::Lyric) as usize;
        // A speech followed by a speech whose cue is marked dual: one DualDialogue.
        if b.kind == BlockKind::Character {
            let end_of = |from: usize| (from + 1..blocks.len()).find(|&j| !matches!(blocks[j].kind, BlockKind::Parenthetical | BlockKind::Dialogue | BlockKind::Lyric)).unwrap_or(blocks.len());
            let left_end = end_of(i);
            if left_end < blocks.len() && blocks[left_end].kind == BlockKind::Character && blocks[left_end].dual {
                let right_end = end_of(left_end);
                let page = if b.break_before { " StartsNewPage=\"Yes\"" } else { "" };
                out.push_str(&format!("    <Paragraph{page}>\n      <DualDialogue>\n"));
                for inner in &blocks[i..right_end] {
                    lyrics += (inner.kind == BlockKind::Lyric && inner as *const _ != b as *const _) as usize;
                    out.push_str("    ");
                    let mut plain = inner.clone();
                    plain.break_before = false;
                    out.push_str(&paragraph(&plain, &mut markup));
                }
                out.push_str("      </DualDialogue>\n    </Paragraph>\n");
                i = right_end;
                continue;
            }
        }
        out.push_str(&paragraph(b, &mut markup));
        i += 1;
    }
    out.push_str("  </Content>\n");
    if !title_page.is_empty() {
        out.push_str(&title_page_xml(title_page));
    }
    out.push_str("</FinalDraft>\n");
    let mut notes = Vec::new();
    let plural = |n: usize| if n == 1 { "" } else { "s" };
    if sections > 0 {
        notes.push(format!("{sections} section{} written as General paragraphs.", plural(sections)));
    }
    if lyrics > 0 {
        notes.push(format!("{lyrics} lyric line{} written as Dialogue.", plural(lyrics)));
    }
    if markup > 0 {
        notes.push(format!("Text colour and highlight left out ({markup} marked run{}): they are on-screen markup only.", plural(markup)));
    }
    notes.push("Final Draft lays out its own pages; page breaks you forced are kept. Not yet checked against Final Draft itself.".into());
    Exported { text: out, notes }
}

// ---------------------------------------------------------------- import --

fn attr(e: &BytesStart, name: &str) -> Option<String> {
    e.attributes().flatten().find(|a| a.key.as_ref() == name).and_then(|a| a.normalized_value(XmlVersion::Implicit1_0).ok().map(|v| v.into_owned()))
}

fn kind_of(t: &str) -> Option<BlockKind> {
    Some(match t {
        "Scene Heading" => BlockKind::Heading,
        "Action" | "General" => BlockKind::Action,
        "Character" => BlockKind::Character,
        "Parenthetical" => BlockKind::Parenthetical,
        "Dialogue" => BlockKind::Dialogue,
        "Transition" => BlockKind::Transition,
        "Shot" => BlockKind::Shot,
        _ => return None,
    })
}

/// One paragraph as read: its type, text runs and flags.
#[derive(Default)]
struct Para {
    ty: String,
    runs: Vec<Run>,
    new_page: bool,
    number: Option<String>,
    align: String,
}

pub fn import(source: &str, fallback_title: &str) -> Result<Imported, String> {
    let mut reader = Reader::from_str(source.trim_start_matches('\u{feff}'));
    reader.config_mut().trim_text(false);
    let mut stack: Vec<String> = Vec::new();
    let mut script: Vec<(Para, bool)> = Vec::new(); // (paragraph, inside DualDialogue)
    let mut title_paras: Vec<Para> = Vec::new();
    let mut cur: Option<Para> = None;
    let mut cur_style: Option<String> = None;
    let mut dual_depth = 0usize;
    let mut dual_start: Option<usize> = None;
    let mut ignored: BTreeMap<String, usize> = BTreeMap::new();
    let mut script_notes = 0usize;
    let mut saw_root = false;
    let in_title = |stack: &[String]| stack.iter().any(|s| s == "TitlePage");
    let in_content = |stack: &[String]| stack.iter().any(|s| s == "Content");
    loop {
        match reader.read_event().map_err(|e| format!("This is not a readable .fdx file (XML error at byte {}): {e}", reader.buffer_position()))? {
            Event::Start(e) => {
                let name = e.name().as_ref().to_string();
                match name.as_str() {
                    "FinalDraft" => saw_root = true,
                    "Paragraph" if in_content(&stack) => {
                        // A paragraph that only wraps DualDialogue carries the page break.
                        cur = Some(Para {
                            ty: attr(&e, "Type").unwrap_or_default(),
                            new_page: attr(&e, "StartsNewPage").as_deref() == Some("Yes"),
                            number: attr(&e, "Number").filter(|n| !n.is_empty()),
                            align: attr(&e, "Alignment").unwrap_or_default(),
                            runs: Vec::new(),
                        });
                    }
                    "Text" => cur_style = Some(attr(&e, "Style").unwrap_or_default()),
                    "DualDialogue" => {
                        dual_depth += 1;
                        // The wrapping paragraph is not a block of its own; keep its page break.
                        if let Some(p) = cur.take() {
                            dual_start = Some(script.len());
                            if p.new_page {
                                script.push((Para { ty: "__break".into(), ..Default::default() }, false));
                            }
                        }
                    }
                    "ScriptNote" => script_notes += 1,
                    "Content" | "TitlePage" | "SceneProperties" | "ScriptNotes" => {}
                    // Inside a script note, everything is part of the note.
                    _ if stack.iter().any(|s| s == "ScriptNote") => {}
                    other => *ignored.entry(other.to_string()).or_default() += 1,
                }
                stack.push(name);
            }
            Event::Empty(e) => {
                let name = e.name().as_ref().to_string();
                if name == "Paragraph" && in_content(&stack) {
                    let p = Para { ty: attr(&e, "Type").unwrap_or_default(), new_page: attr(&e, "StartsNewPage").as_deref() == Some("Yes"), align: attr(&e, "Alignment").unwrap_or_default(), ..Default::default() };
                    if in_title(&stack) { title_paras.push(p) } else { script.push((p, dual_depth > 0)) }
                } else if !matches!(name.as_str(), "Text" | "SceneProperties") && !stack.iter().any(|s| s == "ScriptNote") {
                    *ignored.entry(name).or_default() += 1;
                }
            }
            Event::Text(t) => {
                if let (Some(p), Some(style)) = (cur.as_mut(), cur_style.as_ref()) {
                    // Entity references arrive separately as GeneralRef events.
                    let text = t.xml_content(XmlVersion::Implicit1_0).replace(['\n', '\r', '\t'], " ");
                    let has = |s: &str| style.split('+').any(|x| x.trim().eq_ignore_ascii_case(s));
                    p.runs.push(Run { text, bold: has("Bold"), italic: has("Italic"), underline: has("Underline"), color: None, highlight: None });
                }
            }
            Event::GeneralRef(r) => {
                if let (Some(p), Some(style)) = (cur.as_mut(), cur_style.as_ref()) {
                    let ch = if r.is_char_ref() {
                        r.resolve_char_ref().ok().flatten().map(String::from).unwrap_or_default()
                    } else {
                        match r.as_ref() {
                            "amp" => "&".to_string(),
                            "lt" => "<".into(),
                            "gt" => ">".into(),
                            "quot" => "\"".into(),
                            "apos" => "'".into(),
                            other => format!("&{other};"), // unknown entity: keep it visible
                        }
                    };
                    let has = |s: &str| style.split('+').any(|x| x.trim().eq_ignore_ascii_case(s));
                    p.runs.push(Run { text: ch, bold: has("Bold"), italic: has("Italic"), underline: has("Underline"), color: None, highlight: None });
                }
            }
            Event::End(e) => {
                let name = e.name().as_ref().to_string();
                stack.pop();
                match name.as_str() {
                    "Text" => cur_style = None,
                    "Paragraph" => {
                        if let Some(p) = cur.take() {
                            if in_title(&stack) {
                                title_paras.push(p);
                            } else if in_content(&stack) {
                                script.push((p, dual_depth > 0));
                            }
                        }
                    }
                    "DualDialogue" => {
                        dual_depth = dual_depth.saturating_sub(1);
                        // The second cue inside the group is the right column.
                        if let Some(s) = dual_start.take() {
                            if let Some((p, _)) = script[s..].iter_mut().filter(|(p, d)| *d && p.ty == "Character").nth(1) {
                                p.ty = "Character__dual".into();
                            }
                        }
                    }
                    _ => {}
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }
    if !saw_root {
        return Err("This file has no FinalDraft element, so it is not an .fdx script.".into());
    }

    let mut notes = Vec::new();
    let mut blocks = Vec::new();
    let mut unknown: BTreeMap<String, usize> = BTreeMap::new();
    let mut numbers = Vec::new();
    let mut pending_break = false;
    for (p, _) in script {
        if p.ty == "__break" {
            pending_break = true;
            continue;
        }
        let (kind, dual) = match p.ty.as_str() {
            "Character__dual" => (BlockKind::Character, true),
            t => match kind_of(t) {
                Some(k) => (k, false),
                None => {
                    *unknown.entry(if t.is_empty() { "(no type)".into() } else { t.to_string() }).or_default() += 1;
                    (BlockKind::Action, false)
                }
            },
        };
        if let Some(n) = &p.number {
            if kind == BlockKind::Heading {
                numbers.push(n.clone());
            }
        }
        let mut b = Block::new(kind, "");
        // Merge neighbouring runs with the same marks.
        let mut runs: Vec<Run> = Vec::new();
        for r in p.runs.into_iter().filter(|r| !r.text.is_empty()) {
            match runs.last_mut() {
                Some(l) if (l.bold, l.italic, l.underline) == (r.bold, r.italic, r.underline) => l.text.push_str(&r.text),
                _ => runs.push(r),
            }
        }
        if runs.is_empty() {
            runs.push(Run::plain(""));
        }
        b.runs = runs;
        b.dual = dual;
        b.break_before = p.new_page || std::mem::take(&mut pending_break);
        // Empty spacer paragraphs carry no script content.
        if b.text().trim().is_empty() && kind != BlockKind::Heading {
            pending_break |= b.break_before;
            continue;
        }
        blocks.push(b);
    }
    if blocks.is_empty() {
        blocks.push(Block::new(BlockKind::Heading, ""));
    }

    // Title page by position.
    let mut tp = TitlePage::default();
    let text_of = |p: &Para| p.runs.iter().map(|r| r.text.as_str()).collect::<String>().trim().to_string();
    let centred: Vec<String> = title_paras.iter().filter(|p| p.align.eq_ignore_ascii_case("Center")).map(text_of).filter(|t| !t.is_empty()).collect();
    let left: Vec<String> = title_paras.iter().filter(|p| p.align.is_empty() || p.align.eq_ignore_ascii_case("Left")).map(text_of).filter(|t| !t.is_empty()).collect();
    let right: Vec<String> = title_paras.iter().filter(|p| p.align.eq_ignore_ascii_case("Right")).map(text_of).filter(|t| !t.is_empty()).collect();
    if let Some((first, rest)) = centred.split_first() {
        tp.title = first.clone();
        let mut rest = rest.to_vec();
        if rest.first().is_some_and(|l| l.to_lowercase().split_whitespace().any(|w| w == "by")) {
            tp.credit = rest.remove(0);
        }
        tp.authors = rest.join("\n");
        tp.contact = left.join("\n");
        tp.notes = right.join("\n");
        notes.push("The title page was read by position (centred: title, credit, authors; left: contact; right: notes). Check it in File > Title Page….".into());
    }

    let plural = |n: usize| if n == 1 { "" } else { "s" };
    if !unknown.is_empty() {
        let list: Vec<String> = unknown.iter().map(|(t, n)| format!("{t} ×{n}")).collect();
        notes.push(format!("Paragraph types Kolbítar does not have were imported as action with their text kept: {}.", list.join(", ")));
    }
    if !numbers.is_empty() {
        notes.push(format!("{} scene number{} not kept (scene numbering comes in a later step): {}.", numbers.len(), plural(numbers.len()), numbers.join(", ")));
    }
    if script_notes > 0 {
        notes.push(format!("{script_notes} script note{} not imported (comments come in a later milestone).", plural(script_notes)));
    }
    let ignored: Vec<String> = ignored.into_iter().filter(|(n, _)| !matches!(n.as_str(), "Text" | "Paragraph" | "DualDialogue")).map(|(n, _)| n).collect();
    if !ignored.is_empty() {
        notes.push(format!("Final Draft settings Kolbítar does not use were left out: {}.", ignored.join(", ")));
    }
    let title = if tp.title.is_empty() { fallback_title.to_string() } else { tp.title.clone() };
    Ok(Imported { document: Document { title, version: 0, blocks }, title_page: tp, notes })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shape(blocks: &[Block]) -> Vec<(String, Vec<(String, bool, bool, bool)>, bool, bool)> {
        blocks
            .iter()
            .map(|b| {
                let kind = match b.kind {
                    BlockKind::Section => BlockKind::Action,
                    BlockKind::Lyric => BlockKind::Dialogue,
                    k => k,
                };
                let mut runs: Vec<(String, bool, bool, bool)> = Vec::new();
                for r in b.runs.iter().filter(|r| !r.text.is_empty()) {
                    match runs.last_mut() {
                        Some(l) if (l.1, l.2, l.3) == (r.bold, r.italic, r.underline) => l.0.push_str(&r.text),
                        _ => runs.push((r.text.clone(), r.bold, r.italic, r.underline)),
                    }
                }
                (kind.as_str().to_string(), runs, b.dual, b.break_before)
            })
            .collect()
    }

    #[test]
    fn fixtures_round_trip_through_fdx() {
        for f in [crate::fixtures::unicode_marks(), crate::fixtures::page_boundaries(), crate::fixtures::long_script(20)] {
            let doc = f.to_document().unwrap();
            let tp = TitlePage { title: "ROUND TRIP".into(), credit: "Written by".into(), authors: "Jared Hoy".into(), contact: "jared@example.invalid\n555 0100".into(), ..Default::default() };
            let out = export(&doc.blocks, &tp);
            let back = import(&out.text, "fallback").unwrap();
            assert_eq!(shape(&back.document.blocks), shape(&doc.blocks), "{}", doc.title);
            assert_eq!((back.title_page.title.as_str(), back.title_page.credit.as_str(), back.title_page.authors.as_str(), back.title_page.contact.as_str()), ("ROUND TRIP", "Written by", "Jared Hoy", "jared@example.invalid\n555 0100"));
        }
    }

    #[test]
    fn imports_a_hand_written_fdx_and_reports_what_it_cannot_keep() {
        let src = r#"<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<FinalDraft DocumentType="Script" Template="No" Version="5">
  <Content>
    <Paragraph Number="7A" Type="Scene Heading"><SceneProperties Length="1/8" Page="1"/><Text>INT. FORGE - NIGHT</Text></Paragraph>
    <Paragraph Type="Action"><Text>Sparks fly &amp; a </Text><Text Style="Italic">bell</Text><Text> rings.</Text></Paragraph>
    <Paragraph><DualDialogue>
      <Paragraph Type="Character"><Text>MARA</Text></Paragraph>
      <Paragraph Type="Dialogue"><Text Style="Bold+Underline">Now</Text><Text>.</Text></Paragraph>
      <Paragraph Type="Character"><Text>BRAM</Text></Paragraph>
      <Paragraph Type="Parenthetical"><Text>(calm)</Text></Paragraph>
      <Paragraph Type="Dialogue"><Text>No.</Text></Paragraph>
    </DualDialogue></Paragraph>
    <Paragraph Type="Cast List"><Text>MARA, BRAM</Text></Paragraph>
    <Paragraph Type="Transition"><Text>CUT TO:</Text></Paragraph>
    <Paragraph StartsNewPage="Yes" Type="Scene Heading"><Text>EXT. QUAY - DAWN</Text></Paragraph>
    <Paragraph Type="Action"><Text></Text></Paragraph>
  </Content>
  <ScriptNotes><ScriptNote><Paragraph><Text>fix this</Text></Paragraph></ScriptNote></ScriptNotes>
  <ElementSettings Type="Action"/>
  <SmartType/>
  <TitlePage><Content>
    <Paragraph Alignment="Center"><Text>SALT AND IRON</Text></Paragraph>
    <Paragraph Alignment="Center"><Text>Written by</Text></Paragraph>
    <Paragraph Alignment="Center"><Text>Jared Hoy</Text></Paragraph>
    <Paragraph Alignment="Left"><Text>jared@example.invalid</Text></Paragraph>
    <Paragraph Alignment="Right"><Text>First Draft</Text></Paragraph>
  </Content></TitlePage>
</FinalDraft>"#;
        let r = import(src, "fallback").unwrap();
        let kinds: Vec<&str> = r.document.blocks.iter().map(|b| b.kind.as_str()).collect();
        assert_eq!(kinds, ["heading", "action", "character", "dialogue", "character", "parenthetical", "dialogue", "action", "transition", "heading"]);
        let b = &r.document.blocks;
        assert_eq!(b[1].text(), "Sparks fly & a bell rings.");
        assert!(b[1].runs.iter().any(|x| x.italic && x.text == "bell"));
        assert!(b[3].runs.iter().any(|x| x.bold && x.underline && x.text == "Now"));
        assert!(!b[2].dual && b[4].dual, "second cue in the group is the right column");
        assert_eq!(b[7].text(), "MARA, BRAM", "unknown type kept as action text");
        assert!(b[9].break_before);
        assert_eq!((r.title_page.title.as_str(), r.title_page.credit.as_str(), r.title_page.authors.as_str()), ("SALT AND IRON", "Written by", "Jared Hoy"));
        assert_eq!((r.title_page.contact.as_str(), r.title_page.notes.as_str()), ("jared@example.invalid", "First Draft"));
        let all = r.notes.join(" ");
        for expected in ["Cast List", "7A", "script note", "ElementSettings", "SmartType", "title page"] {
            assert!(all.contains(expected), "report mentions {expected}: {all}");
        }
        assert!(import("<html></html>", "x").is_err(), "not an fdx");
        assert!(import("<FinalDraft><Content><Paragraph", "x").is_err(), "broken XML is an error, not a partial import");
    }

    #[test]
    fn export_reports_what_fdx_cannot_carry_and_escapes_text() {
        let mut lyric = Block::new(BlockKind::Lyric, "La <la> & \"la\"");
        lyric.runs[0].highlight = Some("yellow".into());
        let blocks = vec![Block::new(BlockKind::Section, "Act two"), Block::new(BlockKind::Character, "MARA"), lyric];
        let out = export(&blocks, &TitlePage::default());
        assert!(out.text.contains("<Paragraph Type=\"General\"><Text>Act two</Text></Paragraph>"));
        assert!(out.text.contains("La &lt;la&gt; &amp; &quot;la&quot;"), "{}", out.text);
        let all = out.notes.join(" ");
        assert!(all.contains("section") && all.contains("lyric") && all.contains("colour"), "{all}");
        assert!(!out.text.contains("<TitlePage>"), "no title page without a title");
        assert_eq!(import(&out.text, "x").unwrap().document.blocks[2].text(), "La <la> & \"la\"");
    }
}
