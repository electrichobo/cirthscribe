//! Screenplay pagination for a fixed-pitch profile.
//!
//! This is the one authoritative page map. The editor's page markers and the
//! PDF both consume it; neither measures text on its own. Because the
//! profile is fixed-pitch (Courier Prime, 10 characters per inch, 6 lines per
//! inch), line breaking depends only on text and profile, not on the OS,
//! WebView or zoom. Characters whose glyphs are missing from the font are
//! reported (see `fontcheck`), because a fallback font would break the
//! fixed-pitch assumption.
//!
//! Offsets in the page map are Unicode scalar values (Rust `char`s) into
//! the block's plain text. The TypeScript side converts to UTF-16.

use crate::model::{Block, BlockKind, Id};
use serde::Serialize;
use unicode_segmentation::UnicodeSegmentation;
use unicode_width::UnicodeWidthStr;

pub const ENGINE_VERSION: &str = "cirth-layout/0.1-m0";

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub enum Align {
    Left,
    Right,
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct Geometry {
    pub left_in: f32,
    pub width_ch: usize,
    pub align: Align,
    pub space_before: usize,
    pub uppercase: bool,
}

const fn g(left_in: f32, width_ch: usize, space_before: usize, uppercase: bool) -> Geometry {
    Geometry { left_in, width_ch, align: Align::Left, space_before, uppercase }
}

#[derive(Clone, Debug, Serialize)]
pub struct Profile {
    pub name: &'static str,
    pub page_w_in: f32,
    pub page_h_in: f32,
    pub top_in: f32,
    pub bottom_in: f32,
    pub lines_per_inch: f32,
    pub chars_per_inch: f32,
    pub font_pt: f32,
    pub heading: Geometry,
    pub action: Geometry,
    pub character: Geometry,
    pub parenthetical: Geometry,
    pub dialogue: Geometry,
    pub transition: Geometry,
    /// Dual dialogue: (cue, parenthetical, dialogue) per column.
    pub dual_left: [Geometry; 3],
    pub dual_right: [Geometry; 3],
    pub more: &'static str,
    pub contd: &'static str,
    /// Minimum lines on each side of a split paragraph or speech.
    pub min_split: usize,
}

impl Profile {
    /// Draft US feature profile. Measurements follow common published
    /// guidance; they have not been checked against industry PDFs yet.
    pub fn us_letter() -> Profile {
        Profile {
            name: "us-feature-letter-draft",
            page_w_in: 8.5,
            page_h_in: 11.0,
            top_in: 1.0,
            bottom_in: 1.0,
            lines_per_inch: 6.0,
            chars_per_inch: 10.0,
            font_pt: 12.0,
            heading: g(1.5, 60, 1, true),
            action: g(1.5, 60, 1, false),
            character: g(3.7, 38, 1, true),
            parenthetical: g(3.1, 25, 0, false),
            dialogue: g(2.5, 35, 0, false),
            transition: Geometry { left_in: 5.5, width_ch: 20, align: Align::Right, space_before: 1, uppercase: true },
            dual_left: [g(2.2, 25, 1, true), g(1.8, 20, 0, false), g(1.5, 28, 0, false)],
            dual_right: [g(5.2, 23, 1, true), g(4.8, 20, 0, false), g(4.5, 28, 0, false)],
            more: "(MORE)",
            contd: " (CONT'D)",
            min_split: 2,
        }
    }

    pub fn a4() -> Profile {
        Profile { name: "us-feature-a4-draft", page_w_in: 8.27, page_h_in: 11.69, ..Profile::us_letter() }
    }

    pub fn screenplay_us() -> Profile {
        Profile::us_letter()
    }

    pub fn screenplay_uk() -> Profile {
        Profile {
            name: "uk-feature-a4",
            page_w_in: 8.27,
            page_h_in: 11.69,
            top_in: 1.0,
            bottom_in: 1.0,
            lines_per_inch: 6.0,
            chars_per_inch: 10.0,
            font_pt: 12.0,
            heading: g(1.5, 58, 1, true),
            action: g(1.5, 58, 1, false),
            character: g(3.5, 36, 1, true),
            parenthetical: g(2.9, 24, 0, false),
            dialogue: g(2.5, 36, 0, false),
            transition: Geometry { left_in: 5.2, width_ch: 20, align: Align::Right, space_before: 1, uppercase: true },
            dual_left: [g(2.0, 24, 1, true), g(1.7, 19, 0, false), g(1.4, 26, 0, false)],
            dual_right: [g(4.9, 22, 1, true), g(4.6, 19, 0, false), g(4.3, 26, 0, false)],
            more: "(MORE)",
            contd: " (CONT'D)",
            min_split: 2,
        }
    }

    pub fn teleplay_multicam() -> Profile {
        Profile {
            name: "teleplay-multicam-sitcom",
            page_w_in: 8.5,
            page_h_in: 11.0,
            top_in: 1.0,
            bottom_in: 1.0,
            lines_per_inch: 6.0,
            chars_per_inch: 10.0,
            font_pt: 12.0,
            heading: g(1.5, 60, 2, true),
            action: g(1.5, 60, 1, true),
            character: g(4.0, 32, 1, true),
            parenthetical: g(3.3, 22, 0, false),
            dialogue: g(2.5, 38, 0, true),
            transition: Geometry { left_in: 5.5, width_ch: 20, align: Align::Right, space_before: 1, uppercase: true },
            dual_left: [g(2.2, 25, 1, true), g(1.8, 20, 0, false), g(1.5, 28, 0, true)],
            dual_right: [g(5.2, 23, 1, true), g(4.8, 20, 0, false), g(4.5, 28, 0, true)],
            more: "(MORE)",
            contd: " (CONT'D)",
            min_split: 2,
        }
    }

    pub fn stageplay() -> Profile {
        Profile {
            name: "theatrical-stageplay",
            page_w_in: 8.5,
            page_h_in: 11.0,
            top_in: 1.0,
            bottom_in: 1.0,
            lines_per_inch: 6.0,
            chars_per_inch: 10.0,
            font_pt: 12.0,
            heading: g(1.5, 60, 2, true),
            action: g(1.5, 60, 1, false),
            character: g(3.8, 35, 1, true),
            parenthetical: g(2.8, 30, 0, false),
            dialogue: g(2.2, 42, 0, false),
            transition: Geometry { left_in: 5.5, width_ch: 20, align: Align::Right, space_before: 1, uppercase: true },
            dual_left: [g(2.0, 25, 1, true), g(1.8, 20, 0, false), g(1.5, 28, 0, false)],
            dual_right: [g(5.0, 23, 1, true), g(4.8, 20, 0, false), g(4.5, 28, 0, false)],
            more: "(MORE)",
            contd: " (CONT'D)",
            min_split: 2,
        }
    }

    pub fn comic() -> Profile {
        Profile {
            name: "comic-graphic-novel",
            page_w_in: 8.5,
            page_h_in: 11.0,
            top_in: 1.0,
            bottom_in: 1.0,
            lines_per_inch: 6.0,
            chars_per_inch: 10.0,
            font_pt: 12.0,
            heading: g(1.25, 65, 2, true),
            action: g(1.25, 65, 1, false),
            character: g(2.5, 45, 1, true),
            parenthetical: g(2.5, 40, 0, false),
            dialogue: g(2.5, 45, 0, false),
            transition: Geometry { left_in: 1.25, width_ch: 65, align: Align::Left, space_before: 1, uppercase: true },
            dual_left: [g(1.5, 28, 1, true), g(1.5, 25, 0, false), g(1.5, 30, 0, false)],
            dual_right: [g(4.8, 28, 1, true), g(4.8, 25, 0, false), g(4.8, 30, 0, false)],
            more: "(MORE)",
            contd: " (CONT'D)",
            min_split: 2,
        }
    }

    pub fn interactive() -> Profile {
        Profile {
            name: "interactive-branching",
            page_w_in: 8.5,
            page_h_in: 11.0,
            top_in: 1.0,
            bottom_in: 1.0,
            lines_per_inch: 6.0,
            chars_per_inch: 10.0,
            font_pt: 12.0,
            heading: g(1.25, 65, 2, true),
            action: g(1.25, 65, 1, false),
            character: g(2.0, 50, 1, true),
            parenthetical: g(2.0, 50, 0, false),
            dialogue: g(2.0, 55, 0, false),
            transition: Geometry { left_in: 1.25, width_ch: 65, align: Align::Left, space_before: 1, uppercase: true },
            dual_left: [g(1.5, 28, 1, true), g(1.5, 25, 0, false), g(1.5, 30, 0, false)],
            dual_right: [g(4.8, 28, 1, true), g(4.8, 25, 0, false), g(4.8, 30, 0, false)],
            more: "(MORE)",
            contd: " (CONT'D)",
            min_split: 2,
        }
    }

    pub fn treatment() -> Profile {
        Profile {
            name: "treatment-prose",
            page_w_in: 8.5,
            page_h_in: 11.0,
            top_in: 1.0,
            bottom_in: 1.0,
            lines_per_inch: 6.0,
            chars_per_inch: 10.0,
            font_pt: 12.0,
            heading: g(1.0, 65, 2, true),
            action: g(1.0, 65, 1, false),
            character: g(1.5, 55, 1, true),
            parenthetical: g(1.5, 55, 0, false),
            dialogue: g(1.5, 55, 0, false),
            transition: Geometry { left_in: 1.0, width_ch: 65, align: Align::Left, space_before: 1, uppercase: true },
            dual_left: [g(1.2, 28, 1, true), g(1.2, 25, 0, false), g(1.2, 30, 0, false)],
            dual_right: [g(4.5, 28, 1, true), g(4.5, 25, 0, false), g(4.5, 30, 0, false)],
            more: "(MORE)",
            contd: " (CONT'D)",
            min_split: 2,
        }
    }

    pub fn for_document_profile(profile: crate::model::DocumentProfile, page_size: Option<&str>) -> Profile {
        match profile {
            crate::model::DocumentProfile::ScreenplayUs => match page_size {
                Some("a4") => Profile::a4(),
                _ => Profile::us_letter(),
            },
            crate::model::DocumentProfile::ScreenplayUk => Profile::screenplay_uk(),
            crate::model::DocumentProfile::TeleplayMultiCam => Profile::teleplay_multicam(),
            crate::model::DocumentProfile::StagePlay => Profile::stageplay(),
            crate::model::DocumentProfile::ComicScript => Profile::comic(),
            crate::model::DocumentProfile::InteractiveStory => Profile::interactive(),
            crate::model::DocumentProfile::TreatmentProse => Profile::treatment(),
        }
    }

    pub fn body_lines(&self) -> usize {
        ((self.page_h_in - self.top_in - self.bottom_in) * self.lines_per_inch).floor() as usize
    }

    pub fn geom(&self, kind: BlockKind) -> Geometry {
        match kind {
            BlockKind::Heading | BlockKind::Shot | BlockKind::Section => self.heading,
            BlockKind::Action => self.action,
            BlockKind::Character => self.character,
            BlockKind::Parenthetical => self.parenthetical,
            BlockKind::Dialogue | BlockKind::Lyric => self.dialogue,
            BlockKind::Transition => self.transition,
        }
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Seg {
    pub text: String,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct PLine {
    /// 0-based row within the page body.
    pub row: usize,
    pub x_in: f32,
    pub segs: Vec<Seg>,
    pub block_id: Option<Id>,
    pub kind: &'static str,
    /// Source range in the block's text, in Unicode scalar values.
    pub start: usize,
    pub end: usize,
    /// "(MORE)" or a "(CONT'D)" cue added by the layout, not manuscript text.
    pub synthetic: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct Page {
    /// Physical page count from 1 (page 1 prints no number).
    pub number: usize,
    /// Printed page number: the same as `number`, or a locked label such as
    /// "12A" or "11-12" (locked.rs).
    pub label: String,
    pub lines: Vec<PLine>,
    /// Holds text of the revision set being printed (revisions.rs).
    pub revised: bool,
}

/// Where each page starts in the manuscript, for editor markers.
#[derive(Clone, Debug, Serialize)]
pub struct PageStart {
    pub page: usize,
    pub label: String,
    pub block_id: Id,
    pub offset: usize,
}

#[derive(Clone, Debug, Serialize)]
pub struct PageMap {
    pub profile: &'static str,
    pub engine: &'static str,
    pub doc_version: u64,
    pub body_lines: usize,
    pub pages: Vec<Page>,
    pub page_starts: Vec<PageStart>,
    pub warnings: Vec<String>,
}

/// A wrapped line before placement.
#[derive(Clone, Debug)]
struct WLine {
    x_in: f32,
    segs: Vec<Seg>,
    block_id: Option<Id>,
    kind: BlockKind,
    start: usize,
    end: usize,
    synthetic: bool,
    /// Ends a sentence: a preferred split point.
    sentence_end: bool,
}

fn display_width(s: &str) -> usize {
    UnicodeWidthStr::width(s)
}

/// Greedy word wrap by display columns. Returns char ranges. Whitespace at a
/// break is consumed (belongs to neither line). Over-long words break at
/// grapheme boundaries.
pub fn wrap(text: &str, width: usize) -> Vec<(usize, usize)> {
    let width = width.max(1);
    let graphemes: Vec<(usize, &str)> = {
        let mut out = Vec::new();
        let mut ci = 0;
        for gr in text.graphemes(true) {
            out.push((ci, gr));
            ci += gr.chars().count();
        }
        out
    };
    let total_chars = text.chars().count();
    if graphemes.is_empty() {
        return vec![(0, 0)];
    }
    let mut lines = Vec::new();
    let mut i = 0;
    while i < graphemes.len() {
        // Skip leading spaces on continuation lines.
        if !lines.is_empty() {
            while i < graphemes.len() && graphemes[i].1 == " " {
                i += 1;
            }
            if i >= graphemes.len() {
                break;
            }
        }
        let start = i;
        let mut col = 0;
        let mut last_space: Option<usize> = None;
        let mut j = i;
        while j < graphemes.len() {
            let gr = graphemes[j].1;
            if gr == "\n" {
                break;
            }
            let w = display_width(gr);
            if col + w > width {
                break;
            }
            if gr == " " {
                last_space = Some(j);
            }
            col += w;
            j += 1;
        }
        let at_end = j >= graphemes.len();
        let hard_newline = !at_end && graphemes[j].1 == "\n";
        let (end, next) = if at_end || hard_newline {
            (j, if hard_newline { j + 1 } else { j })
        } else if graphemes[j].1 == " " {
            (j, j + 1)
        } else if let Some(sp) = last_space.filter(|&sp| sp > start) {
            (sp, sp + 1)
        } else if j == start {
            (j + 1, j + 1) // a single grapheme wider than the line
        } else {
            (j, j)
        };
        let s = graphemes[start].0;
        let e = if end >= graphemes.len() { total_chars } else { graphemes[end].0 };
        // Trim trailing spaces from the visible range.
        let line: String = text.chars().skip(s).take(e - s).collect();
        let trimmed = line.trim_end_matches(' ').chars().count();
        lines.push((s, s + trimmed));
        i = next;
    }
    if lines.is_empty() {
        lines.push((0, 0));
    }
    lines
}

fn slice_runs(block: &Block, start: usize, end: usize, upper: bool) -> Vec<Seg> {
    let mut segs: Vec<Seg> = Vec::new();
    let mut pos = 0;
    for r in &block.runs {
        let n = r.text.chars().count();
        let (a, b) = (start.max(pos), end.min(pos + n));
        if a < b {
            let mut t: String = r.text.chars().skip(a - pos).take(b - a).collect();
            if upper {
                t = t.to_uppercase();
            }
            match segs.last_mut() {
                Some(l) if l.bold == r.bold && l.italic == r.italic && l.underline == r.underline => l.text.push_str(&t),
                _ => segs.push(Seg { text: t, bold: r.bold, italic: r.italic, underline: r.underline }),
            }
        }
        pos += n;
    }
    segs
}

fn ends_sentence(text: &str, end: usize) -> bool {
    let line: String = text.chars().take(end).collect();
    let t = line.trim_end_matches(['"', '\'', ')', '\u{201D}', '\u{2019}']);
    t.ends_with(['.', '!', '?', '\u{2026}']) || t.ends_with("--")
}

fn wrap_block(p: &Profile, b: &Block, geom: Geometry) -> Vec<WLine> {
    let text = b.text();
    let ranges = wrap(&text, geom.width_ch);
    ranges
        .into_iter()
        .map(|(s, e)| {
            let segs = slice_runs(b, s, e, geom.uppercase);
            let w: usize = segs.iter().map(|s| display_width(&s.text)).sum();
            let x_in = match geom.align {
                Align::Left => geom.left_in,
                Align::Right => geom.left_in + (geom.width_ch.saturating_sub(w)) as f32 / p.chars_per_inch,
            };
            WLine { x_in, segs, block_id: Some(b.id.clone()), kind: b.kind, start: s, end: e, synthetic: false, sentence_end: ends_sentence(&text, e) }
        })
        .collect()
}

/// A layout unit: one block, or one speech (cue + parentheticals + dialogue).
#[derive(Debug)]
enum Unit<'a> {
    Single(&'a Block),
    Speech(Vec<&'a Block>),
    Dual(Vec<&'a Block>, Vec<&'a Block>),
}

fn group(blocks: &[Block]) -> Vec<Unit<'_>> {
    let mut units: Vec<Unit> = Vec::new();
    let mut i = 0;
    while i < blocks.len() {
        let b = &blocks[i];
        if b.kind.is_speech() {
            let mut sp = vec![b];
            i += 1;
            while i < blocks.len() && blocks[i].kind.is_speech() && blocks[i].kind != BlockKind::Character {
                sp.push(&blocks[i]);
                i += 1;
            }
            let is_right = b.kind == BlockKind::Character && b.dual;
            match units.last_mut() {
                Some(Unit::Speech(prev)) if is_right && prev[0].kind == BlockKind::Character => {
                    let left = std::mem::take(prev);
                    *units.last_mut().unwrap() = Unit::Dual(left, sp);
                }
                _ => units.push(Unit::Speech(sp)),
            }
        } else {
            units.push(Unit::Single(b));
            i += 1;
        }
    }
    units
}

struct Pager<'p> {
    p: &'p Profile,
    body: usize,
    pages: Vec<Page>,
    row: usize,
    warnings: Vec<String>,
}

impl<'p> Pager<'p> {
    fn cur(&mut self) -> &mut Page {
        self.pages.last_mut().unwrap()
    }
    fn new_page(&mut self) {
        let n = self.pages.len() + 1;
        self.pages.push(Page { number: n, label: n.to_string(), lines: Vec::new(), revised: false });
        self.row = 0;
    }
    fn avail(&self) -> usize {
        self.body - self.row
    }
    fn gap(&self, space_before: usize) -> usize {
        if self.row == 0 { 0 } else { space_before }
    }
    fn place(&mut self, l: WLine) {
        let row = self.row;
        self.cur().lines.push(PLine {
            row,
            x_in: l.x_in,
            segs: l.segs,
            block_id: l.block_id,
            kind: l.kind.as_str(),
            start: l.start,
            end: l.end,
            synthetic: l.synthetic,
        });
        self.row += 1;
    }
    fn place_at(&mut self, l: WLine, row: usize) {
        self.cur().lines.push(PLine {
            row,
            x_in: l.x_in,
            segs: l.segs,
            block_id: l.block_id,
            kind: l.kind.as_str(),
            start: l.start,
            end: l.end,
            synthetic: l.synthetic,
        });
    }
}

fn synthetic(x_in: f32, kind: BlockKind, text: String) -> WLine {
    WLine {
        x_in,
        segs: vec![Seg { text, bold: false, italic: false, underline: false }],
        block_id: None,
        kind,
        start: 0,
        end: 0,
        synthetic: true,
        sentence_end: false,
    }
}

/// Lines of a speech with each line's block-relative split rules.
struct SpeechLines {
    lines: Vec<WLine>,
    /// For each line index i: may the page end after line i?
    breakable_after: Vec<bool>,
    cue_text: Option<String>,
    cue_geom: Geometry,
}

fn speech_lines(p: &Profile, sp: &[&Block], geoms: [Geometry; 3]) -> SpeechLines {
    let mut lines = Vec::new();
    let mut breakable = Vec::new();
    let mut cue_text = None;
    for b in sp {
        let geom = match b.kind {
            BlockKind::Character => geoms[0],
            BlockKind::Parenthetical => geoms[1],
            _ => geoms[2],
        };
        if b.kind == BlockKind::Character {
            cue_text = Some(b.text().to_uppercase());
        }
        let wl = wrap_block(p, b, geom);
        let n = wl.len();
        for (k, l) in wl.into_iter().enumerate() {
            let ok = match b.kind {
                BlockKind::Character | BlockKind::Parenthetical => false,
                // Inside a dialogue block keep min_split lines on each side;
                // the boundary after the block's last line is fine.
                _ => k + 1 == n || (k + 1 >= p.min_split && n - (k + 1) >= p.min_split),
            };
            lines.push(l);
            breakable.push(ok);
        }
    }
    SpeechLines { lines, breakable_after: breakable, cue_text, cue_geom: geoms[0] }
}

/// Lines needed at minimum to start a unit on this page (for keep-with-next).
fn min_start(p: &Profile, u: &Unit) -> usize {
    match u {
        Unit::Single(b) => {
            let n = wrap(&b.text(), p.geom(b.kind).width_ch).len();
            if b.kind == BlockKind::Action && n >= 2 * p.min_split { p.min_split } else { n }
        }
        Unit::Speech(sp) => {
            let s = speech_lines(p, sp, [p.character, p.parenthetical, p.dialogue]);
            // Cue, any parentheticals, then two lines of dialogue.
            let mut need = 0;
            let mut dlg = 0;
            for (l, _) in s.lines.iter().zip(&s.breakable_after) {
                need += 1;
                if !matches!(l.kind, BlockKind::Character | BlockKind::Parenthetical) {
                    dlg += 1;
                    if dlg >= p.min_split {
                        break;
                    }
                }
            }
            need
        }
        Unit::Dual(a, b) => {
            let la = speech_lines(p, a, p.dual_left).lines.len();
            let lb = speech_lines(p, b, p.dual_right).lines.len();
            la.max(lb)
        }
    }
}

fn space_before(p: &Profile, u: &Unit) -> usize {
    match u {
        Unit::Single(b) => p.geom(b.kind).space_before,
        _ => p.character.space_before,
    }
}

fn breaks_before(u: &Unit) -> bool {
    match u {
        Unit::Single(b) => b.break_before,
        Unit::Speech(sp) => sp[0].break_before,
        Unit::Dual(a, _) => a[0].break_before,
    }
}

/// Scene-number margins: left number ends before the heading, right one
/// starts after the text column.
pub const SCENE_NUMBER_LEFT_IN: f32 = 0.75;
pub const SCENE_NUMBER_RIGHT_IN: f32 = 7.4;

/// Pages with locked scene numbers (numbering.rs). Omitted scenes collapse to
/// one "OMITTED" heading (same block id, so page markers still line up) and
/// their other blocks are left out of the pages, not the project. Numbered
/// headings get their number in both margins on their first line.
pub fn paginate_numbered(blocks: &[Block], p: &Profile, doc_version: u64, numbers: &crate::numbering::Numbers) -> PageMap {
    paginate_production(blocks, p, doc_version, numbers, None)
}

/// Pages with locked scene numbers (as `paginate_numbered`) and, when given,
/// against a locked page baseline (locked.rs).
pub fn paginate_production(blocks: &[Block], p: &Profile, doc_version: u64, numbers: &crate::numbering::Numbers, lock: Option<&crate::locked::PageLock>) -> PageMap {
    let lay = |bs: &[Block]| match lock {
        Some(l) => crate::locked::paginate_locked(bs, p, doc_version, l),
        None => paginate(bs, p, doc_version),
    };
    if numbers.is_empty() {
        return lay(blocks);
    }
    let mut shown: Vec<Block> = Vec::with_capacity(blocks.len());
    let mut skipping = false;
    for b in blocks {
        if b.kind == BlockKind::Heading {
            let n = b.scene_id.as_ref().and_then(|id| numbers.get(id));
            skipping = n.is_some_and(|n| n.omitted);
            if skipping {
                let mut omitted = b.clone();
                omitted.runs = vec![crate::model::Run::plain("OMITTED")];
                shown.push(omitted);
                continue;
            }
        }
        if !skipping {
            shown.push(b.clone());
        }
    }
    let mut map = lay(&shown);
    let number_of: std::collections::HashMap<&str, &str> = shown
        .iter()
        .filter(|b| b.kind == BlockKind::Heading)
        .filter_map(|b| b.scene_id.as_ref().and_then(|id| numbers.get(id)).map(|n| (b.id.as_str(), n.number.as_str())))
        .collect();
    let char_in = 1.0 / p.chars_per_inch;
    for page in &mut map.pages {
        let mut extra = Vec::new();
        for l in page.lines.iter().filter(|l| l.kind == "heading" && l.start == 0 && !l.synthetic) {
            if let Some(n) = l.block_id.as_deref().and_then(|id| number_of.get(id)) {
                let w = n.chars().count() as f32 * char_in;
                for x in [SCENE_NUMBER_LEFT_IN + 0.5 - w - char_in, SCENE_NUMBER_RIGHT_IN] {
                    extra.push(PLine { row: l.row, x_in: x.max(0.1), segs: vec![Seg { text: n.to_string(), bold: false, italic: false, underline: false }], block_id: None, kind: "scene-number", start: 0, end: 0, synthetic: true });
                }
            }
        }
        page.lines.extend(extra);
    }
    map
}

pub fn paginate(blocks: &[Block], p: &Profile, doc_version: u64) -> PageMap {
    let units = group(blocks);
    let mut pg = Pager { p, body: p.body_lines(), pages: Vec::new(), row: 0, warnings: Vec::new() };
    pg.new_page();
    for (ui, u) in units.iter().enumerate() {
        if breaks_before(u) && pg.row > 0 {
            pg.new_page();
        }
        match u {
            Unit::Single(b) => place_single(&mut pg, b, units.get(ui + 1)),
            Unit::Speech(sp) => place_speech(&mut pg, sp),
            Unit::Dual(a, b) => place_dual(&mut pg, a, b),
        }
    }
    let mut page_starts = Vec::new();
    for page in &pg.pages {
        if let Some(l) = page.lines.iter().find(|l| !l.synthetic && l.block_id.is_some()) {
            page_starts.push(PageStart { page: page.number, label: page.label.clone(), block_id: l.block_id.clone().unwrap(), offset: l.start });
        }
    }
    PageMap {
        profile: p.name,
        engine: ENGINE_VERSION,
        doc_version,
        body_lines: pg.body,
        pages: pg.pages,
        page_starts,
        warnings: pg.warnings,
    }
}

fn place_single(pg: &mut Pager, b: &Block, next: Option<&Unit>) {
    let p = pg.p;
    let geom = p.geom(b.kind);
    let lines = wrap_block(p, b, geom);
    let gap = pg.gap(geom.space_before);
    let n = lines.len();
    let keep_with_next = matches!(b.kind, BlockKind::Heading | BlockKind::Shot | BlockKind::Section);
    let mut need = gap + n;
    if keep_with_next {
        if let Some(nu) = next {
            need += space_before(p, nu) + min_start(p, nu);
        }
    }
    if need <= pg.avail() {
        pg.row += gap;
        lines.into_iter().for_each(|l| pg.place(l));
        return;
    }
    // Paragraph split: only action, min_split lines on each side, prefer a
    // sentence end.
    if b.kind == BlockKind::Action && n >= 2 * p.min_split && pg.avail() >= gap + p.min_split {
        let max_k = (pg.avail() - gap).min(n - p.min_split);
        if max_k >= p.min_split {
            let k = (p.min_split..=max_k).rev().find(|&k| lines[k - 1].sentence_end).unwrap_or(max_k);
            pg.row += gap;
            let mut it = lines.into_iter();
            for _ in 0..k {
                pg.place(it.next().unwrap());
            }
            pg.new_page();
            it.for_each(|l| place_flow(pg, l));
            return;
        }
    }
    if pg.row > 0 {
        pg.new_page();
    }
    lines.into_iter().for_each(|l| place_flow(pg, l));
}

/// Place a line, starting a new page if this one is full.
fn place_flow(pg: &mut Pager, l: WLine) {
    if pg.avail() == 0 {
        pg.new_page();
    }
    pg.place(l);
}

fn place_speech(pg: &mut Pager, sp: &[&Block]) {
    let p = pg.p;
    let s = speech_lines(p, sp, [p.character, p.parenthetical, p.dialogue]);
    let SpeechLines { lines, breakable_after, cue_text, cue_geom } = s;
    let mut lines: Vec<WLine> = lines;
    let mut breakable = breakable_after;
    let mut first = true;
    loop {
        let gap = if first { pg.gap(p.character.space_before) } else { 0 };
        if gap + lines.len() <= pg.avail() {
            pg.row += gap;
            lines.into_iter().for_each(|l| pg.place(l));
            return;
        }
        // Largest k such that k lines + (MORE) fit, the page doesn't end on a
        // cue or parenthetical, and at least min_split dialogue lines go on
        // each page; prefer a sentence end.
        let room = pg.avail().saturating_sub(gap + 1);
        let dialogue_before = |k: usize| lines[..k].iter().filter(|l| !l.synthetic && !matches!(l.kind, BlockKind::Character | BlockKind::Parenthetical)).count();
        let candidates: Vec<usize> = (1..=room.min(lines.len().saturating_sub(1)))
            .filter(|&k| breakable[k - 1] && dialogue_before(k) >= p.min_split && lines.len() - k >= p.min_split)
            .collect();
        let pick = candidates.iter().rev().copied().find(|&k| lines[k - 1].sentence_end).or(candidates.last().copied());
        match pick {
            Some(k) => {
                pg.row += gap;
                let rest = lines.split_off(k);
                let rest_b = breakable.split_off(k);
                lines.into_iter().for_each(|l| pg.place(l));
                pg.place(synthetic(cue_geom.left_in, BlockKind::Character, p.more.to_string()));
                pg.new_page();
                let mut next = Vec::with_capacity(rest.len() + 1);
                let mut next_b = Vec::with_capacity(rest_b.len() + 1);
                if let Some(c) = &cue_text {
                    next.push(synthetic(cue_geom.left_in, BlockKind::Character, format!("{c}{}", p.contd)));
                    next_b.push(false);
                }
                next.extend(rest);
                next_b.extend(rest_b);
                lines = next;
                breakable = next_b;
                first = false;
            }
            None if pg.row > 0 => {
                pg.new_page();
                first = false;
            }
            None => {
                pg.warnings.push(format!(
                    "speech starting at block {} could not be split under the rules; forced a break",
                    lines.iter().find_map(|l| l.block_id.clone()).unwrap_or_default()
                ));
                lines.into_iter().for_each(|l| place_flow(pg, l));
                return;
            }
        }
    }
}

fn place_dual(pg: &mut Pager, a: &[&Block], b: &[&Block]) {
    let p = pg.p;
    let la = speech_lines(p, a, p.dual_left).lines;
    let lb = speech_lines(p, b, p.dual_right).lines;
    let h = la.len().max(lb.len());
    let gap = pg.gap(p.character.space_before);
    if h > pg.body {
        pg.warnings.push(format!(
            "dual dialogue at block {} is taller than a page; laid out as two sequential speeches (M0 limitation)",
            a[0].id
        ));
        place_speech(pg, a);
        place_speech(pg, b);
        return;
    }
    if gap + h > pg.avail() {
        pg.new_page();
    } else {
        pg.row += gap;
    }
    let top = pg.row;
    for (i, l) in la.into_iter().enumerate() {
        pg.place_at(l, top + i);
    }
    for (i, l) in lb.into_iter().enumerate() {
        pg.place_at(l, top + i);
    }
    pg.cur().lines.sort_by_key(|l| l.row);
    pg.row = top + h;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wrap_breaks_at_spaces_and_hard_breaks_long_words() {
        assert_eq!(wrap("hello world", 5), vec![(0, 5), (6, 11)]);
        assert_eq!(wrap("abcdefghij", 4), vec![(0, 4), (4, 8), (8, 10)]);
        assert_eq!(wrap("", 10), vec![(0, 0)]);
        // Exactly fits.
        assert_eq!(wrap("aaaa bbbb", 9), vec![(0, 9)]);
    }

    #[test]
    fn wrap_counts_wide_characters_as_two_columns() {
        // Four CJK characters are 8 columns.
        assert_eq!(wrap("漢字漢字", 4), vec![(0, 2), (2, 4)]);
        // Emoji with modifier is one grapheme.
        let s = "👍🏽👍🏽👍🏽";
        let r = wrap(s, 4);
        assert_eq!(r.len(), 2);
        assert_eq!(r[0], (0, 4)); // two graphemes of two scalars each
    }

    #[test]
    fn layout_profiles_provide_distinct_and_valid_geometries() {
        use crate::model::DocumentProfile;
        for dp in DocumentProfile::ALL {
            let p = Profile::for_document_profile(dp, None);
            assert!(p.page_w_in > 7.0 && p.page_w_in < 9.0);
            assert!(p.page_h_in > 10.0 && p.page_h_in < 13.0);
            assert!(p.body_lines() > 40);
            assert!(p.heading.width_ch > 0);
            assert!(p.action.width_ch > 0);
            assert!(p.dialogue.width_ch > 0);
        }

        let us = Profile::screenplay_us();
        let uk = Profile::screenplay_uk();
        let multicam = Profile::teleplay_multicam();
        let stage = Profile::stageplay();
        let comic = Profile::comic();

        assert_eq!(uk.page_w_in, 8.27);
        assert_eq!(uk.page_h_in, 11.69);
        assert_eq!(us.page_w_in, 8.5);
        assert!(multicam.dialogue.uppercase);
        assert!(!us.dialogue.uppercase);
        assert_eq!(comic.heading.width_ch, 65);
        assert_eq!(stage.dialogue.width_ch, 42);
    }
}
