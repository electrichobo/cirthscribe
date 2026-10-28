//! What DOCX, RTF and HTML exports share: the script as printed paragraphs
//! (the production view: locked scene numbers, omitted scenes as "OMITTED",
//! upper case where the page shows it), paragraph geometry taken from the
//! layout profile, a title page as editable paragraphs, and the notes for
//! what these formats cannot carry.
//!
//! These are document formats: the app that opens them lays out its own
//! pages. They keep editable text, roles (one style per block kind),
//! indents, spacing, emphasis and forced page breaks; they never carry
//! Kolbítar's page map.

use crate::layout::{Align, Profile};
use crate::model::{Block, BlockKind, Run};
use crate::numbering::Numbers;
use crate::title::TitlePage;

/// Everything besides the script itself.
#[derive(Clone, Debug, Default)]
pub struct DocOptions {
    /// Document title and author (file properties / <title>).
    pub title: String,
    pub author: String,
    /// Printed top left and centred at the bottom from page 2 (expanded).
    pub header: String,
    pub footer: String,
}

#[derive(Debug)]
pub struct DocExported {
    pub bytes: Vec<u8>,
    /// What the format could not keep (shown to the user after export).
    pub notes: Vec<String>,
}

/// One printed paragraph.
#[derive(Clone, Debug)]
pub struct Para {
    pub kind: BlockKind,
    /// Text as printed (upper case for headings, cues, transitions, shots).
    pub runs: Vec<Run>,
    /// Locked scene number of a heading.
    pub number: Option<String>,
    pub break_before: bool,
}

/// Indents and spacing of a block kind, in inches from the text column's
/// left edge (the action margin) and its right edge.
#[derive(Clone, Copy, Debug)]
pub struct Geom {
    pub left_in: f32,
    pub right_in: f32,
    pub right_aligned: bool,
    /// Blank lines before the paragraph (12 pt each).
    pub space_before: usize,
    pub keep_with_next: bool,
    pub italic: bool,
}

/// Width of the text column (action margin to 1 in from the right edge).
pub fn column_in(p: &Profile) -> f32 {
    p.page_w_in - 1.0 - p.action.left_in
}

pub fn geom(p: &Profile, kind: BlockKind) -> Geom {
    let g = p.geom(kind);
    let left = g.left_in - p.action.left_in;
    let width = g.width_ch as f32 / p.chars_per_inch;
    Geom {
        left_in: left,
        right_in: (column_in(p) - left - width).max(0.0),
        right_aligned: matches!(g.align, Align::Right),
        space_before: g.space_before,
        keep_with_next: matches!(kind, BlockKind::Heading | BlockKind::Character | BlockKind::Parenthetical | BlockKind::Shot | BlockKind::Section),
        italic: kind == BlockKind::Lyric,
    }
}

/// Style name of a block kind (DOCX style ids, RTF style names, HTML classes).
pub fn style_name(kind: BlockKind) -> &'static str {
    match kind {
        BlockKind::Heading => "Scene Heading",
        BlockKind::Action => "Action",
        BlockKind::Character => "Character",
        BlockKind::Parenthetical => "Parenthetical",
        BlockKind::Dialogue => "Dialogue",
        BlockKind::Transition => "Transition",
        BlockKind::Shot => "Shot",
        BlockKind::Section => "Section",
        BlockKind::Lyric => "Lyric",
    }
}

/// Counts behind the shared notes.
#[derive(Default, Debug)]
pub struct Counts {
    pub markup: usize,
    pub revised: bool,
    pub dual: usize,
    pub omitted: usize,
    pub numbered: usize,
}

/// The script as printed paragraphs, with what had to be changed on the way.
pub fn paras(blocks: &[Block], p: &Profile, numbers: &Numbers) -> (Vec<Para>, Counts) {
    let mut out = Vec::with_capacity(blocks.len());
    let mut c = Counts::default();
    let mut skipping = false;
    for b in blocks {
        c.markup += b.runs.iter().filter(|r| r.color.is_some() || r.highlight.is_some()).count();
        c.revised |= b.runs.iter().any(|r| r.revision.is_some() && !r.text.is_empty());
        let mut number = None;
        if b.kind == BlockKind::Heading {
            let n = b.scene_id.as_ref().and_then(|id| numbers.get(id));
            skipping = n.is_some_and(|n| n.omitted);
            number = n.map(|n| n.number.clone());
            c.numbered += number.is_some() as usize;
            if skipping {
                c.omitted += 1;
                out.push(Para { kind: BlockKind::Heading, runs: vec![Run::plain("OMITTED")], number, break_before: b.break_before });
                continue;
            }
        } else if skipping {
            continue;
        }
        c.dual += (b.kind == BlockKind::Character && b.dual) as usize;
        let upper = p.geom(b.kind).uppercase;
        let runs = b
            .runs
            .iter()
            .filter(|r| !r.text.is_empty())
            .map(|r| Run { text: if upper { r.text.to_uppercase() } else { r.text.clone() }, color: None, highlight: None, revision: None, ..r.clone() })
            .collect();
        out.push(Para { kind: b.kind, runs, number, break_before: b.break_before });
    }
    (out, c)
}

/// Notes every document format shares.
pub fn notes(c: &Counts, format: &str) -> Vec<String> {
    let plural = |n: usize| if n == 1 { "" } else { "s" };
    let mut notes = vec![format!(
        "{format} keeps the text, one paragraph style per element (scene heading, action, character, dialogue …), indents, spacing, bold, italic, underline and forced page breaks. The app that opens it lays out its own pages, so page breaks and page numbers can differ from Kolbítar's PDF; locked page labels such as 12A are not kept."
    )];
    if c.dual > 0 {
        notes.push(format!("{} dual-dialogue pair{} written one speech after the other.", c.dual, plural(c.dual)));
    }
    if c.numbered > 0 {
        notes.push(format!("{} scene number{} written at the start of {} heading.", c.numbered, plural(c.numbered), if c.numbered == 1 { "its" } else { "each" }));
    }
    if c.omitted > 0 {
        notes.push(format!("{} omitted scene{} printed as OMITTED, as in the PDF.", c.omitted, plural(c.omitted)));
    }
    if c.revised {
        notes.push("Revision marks and revision page headers left out; the revised text itself is written.".into());
    }
    if c.markup > 0 {
        notes.push(format!("Text colour and highlight left out ({} marked run{}): they are on-screen markup only.", c.markup, plural(c.markup)));
    }
    notes
}

/// Alignment of a title-page paragraph.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum TitleAlign {
    Centre,
    Left,
    Right,
}

/// One title-page paragraph and the blank lines before it.
#[derive(Clone, Debug)]
pub struct TitlePara {
    pub text: String,
    pub align: TitleAlign,
    pub space_before: usize,
}

/// The title page as editable paragraphs: the centre block a third of the
/// way down (as in the PDF), then contact details (left) and the draft
/// items (right) at the foot of the page, one after the other.
pub fn title_paras(tp: &TitlePage, p: &Profile) -> Vec<TitlePara> {
    let rows = crate::title::rows(p);
    let lines = |t: &str| t.lines().map(str::trim).filter(|l| !l.is_empty()).map(String::from).collect::<Vec<_>>();
    let mut out = Vec::new();
    let mut row = 0usize;
    let mut gap = rows * 3 / 10;
    for (i, block) in [&tp.title, &tp.credit, &tp.authors, &tp.source].into_iter().enumerate() {
        let ls = lines(block);
        if ls.is_empty() {
            continue;
        }
        if i > 0 && !out.is_empty() {
            gap += 1;
        }
        for (k, l) in ls.into_iter().enumerate() {
            out.push(TitlePara { text: l, align: TitleAlign::Centre, space_before: if k == 0 { gap } else { 0 } });
            row += if k == 0 { gap + 1 } else { 1 };
        }
        gap = 0;
    }
    let contact = lines(&tp.contact);
    let corner: Vec<String> = crate::title::corner_text(tp).iter().flat_map(|t| lines(t)).collect();
    let foot = contact.len() + corner.len();
    let mut first = true;
    for (text, align) in contact.into_iter().map(|t| (t, TitleAlign::Left)).chain(corner.into_iter().map(|t| (t, TitleAlign::Right))) {
        let space_before = if first { rows.saturating_sub(foot).saturating_sub(row).max(1) } else { 0 };
        first = false;
        out.push(TitlePara { text, align, space_before });
    }
    out
}

/// Characters XML 1.0 cannot carry (C0 controls other than tab and newline).
pub fn xml_safe(c: char) -> bool {
    !(c < ' ' && c != '\t' && c != '\n') && c != '\u{FFFE}' && c != '\u{FFFF}'
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::numbering::SceneNumber;

    #[test]
    fn production_view_numbers_omits_and_upper_cases() {
        let p = Profile::us_letter();
        let h1 = Block::new(BlockKind::Heading, "int. one - day");
        let a1 = Block::new(BlockKind::Action, "Kept as typed.");
        let h2 = Block::new(BlockKind::Heading, "int. two - day");
        let a2 = Block::new(BlockKind::Action, "Left out.");
        let mut numbers = Numbers::new();
        numbers.insert(h1.scene_id.clone().unwrap(), SceneNumber { scene_id: h1.scene_id.clone().unwrap(), number: "1".into(), omitted: false });
        numbers.insert(h2.scene_id.clone().unwrap(), SceneNumber { scene_id: h2.scene_id.clone().unwrap(), number: "2".into(), omitted: true });
        let (ps, c) = paras(&[h1, a1, h2, a2], &p, &numbers);
        assert_eq!(ps.len(), 3);
        assert_eq!(ps[0].runs[0].text, "INT. ONE - DAY");
        assert_eq!(ps[0].number.as_deref(), Some("1"));
        assert_eq!(ps[1].runs[0].text, "Kept as typed.");
        assert_eq!((ps[2].runs[0].text.as_str(), ps[2].number.as_deref()), ("OMITTED", Some("2")));
        assert_eq!((c.omitted, c.numbered), (1, 2));
    }

    #[test]
    fn geometry_follows_the_layout_profile() {
        let p = Profile::us_letter();
        let d = geom(&p, BlockKind::Dialogue);
        assert!((d.left_in - 1.0).abs() < 0.01 && (d.right_in - 1.5).abs() < 0.01, "{d:?}");
        let a = geom(&p, BlockKind::Action);
        assert!(a.left_in.abs() < 0.01 && a.right_in.abs() < 0.01, "{a:?}");
        assert!(geom(&p, BlockKind::Transition).right_aligned);
    }

    #[test]
    fn title_page_sits_a_third_down_with_the_foot_items_last() {
        let p = Profile::us_letter();
        let tp = TitlePage { title: "THE TIDE LEDGER".into(), credit: "Written by".into(), authors: "A. Writer".into(), contact: "a@example.invalid".into(), draft_label: "First Draft".into(), wga: "123".into(), ..Default::default() };
        let t = title_paras(&tp, &p);
        assert_eq!(t[0].space_before, crate::title::rows(&p) * 3 / 10);
        assert_eq!((t[1].text.as_str(), t[1].space_before), ("Written by", 1));
        let total: usize = t.iter().map(|x| x.space_before + 1).sum();
        assert_eq!(total, crate::title::rows(&p), "fills the page exactly");
        assert_eq!(t.last().unwrap().text, "WGA Registration No. 123");
        assert_eq!(t.last().unwrap().align, TitleAlign::Right);
    }
}
