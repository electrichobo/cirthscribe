//! PDF import (0.8.2, decision 30): a best guess at the screenplay a PDF
//! shows. A PDF keeps only where each letter is drawn, not what kind of
//! paragraph it belongs to, so each line's element is guessed from where it
//! starts on the page (measured from the action margin), its capitals and a
//! few patterns (INT./EXT., TO:, a parenthesis). Page furniture is dropped:
//! page numbers, (MORE), CONTINUED, a revision header. Scene numbers in the
//! margins are kept and locked. Two speeches side by side are read as dual
//! dialogue. A first page with no scene or speech is read as the title page.
//!
//! Styles (bold, italic, underline) are not read. A PDF with no text (a scan)
//! or one locked with a password is refused with a plain message. Everything
//! that was guessed or left out is listed in the import report.

use crate::fdx::Imported;
use crate::model::{Block, BlockKind, Document};
use crate::title::TitlePage;

/// One drawn letter: its left edge and baseline from the page's top left, its
/// advance and size, in points.
#[derive(Clone, Debug, PartialEq)]
pub struct Glyph {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub size: f64,
    pub c: String,
}

#[derive(Clone, Debug, Default)]
pub struct Page {
    pub width: f64,
    pub height: f64,
    pub glyphs: Vec<Glyph>,
}

#[derive(Default)]
struct Collector {
    pages: Vec<Page>,
    cur: Page,
    llx: f64,
    ury: f64,
}

impl pdf_extract::OutputDev for Collector {
    fn begin_page(&mut self, _n: u32, mb: &pdf_extract::MediaBox, _art: Option<(f64, f64, f64, f64)>) -> Result<(), pdf_extract::OutputError> {
        self.llx = mb.llx;
        self.ury = mb.ury;
        self.cur = Page { width: (mb.urx - mb.llx).abs(), height: (mb.ury - mb.lly).abs(), glyphs: Vec::new() };
        Ok(())
    }
    fn end_page(&mut self) -> Result<(), pdf_extract::OutputError> {
        self.pages.push(std::mem::take(&mut self.cur));
        Ok(())
    }
    fn output_character(&mut self, trm: &pdf_extract::Transform, width: f64, _spacing: f64, font_size: f64, c: &str) -> Result<(), pdf_extract::OutputError> {
        let sx = (trm.m11 * trm.m11 + trm.m12 * trm.m12).sqrt();
        let sy = (trm.m21 * trm.m21 + trm.m22 * trm.m22).sqrt();
        let size = font_size * (sx * sy).sqrt();
        if !c.chars().any(|ch| ch.is_control()) && size.is_finite() && size > 0.0 {
            self.cur.glyphs.push(Glyph { x: trm.m31 - self.llx, y: self.ury - trm.m32, w: width * size, size, c: c.to_string() });
        }
        Ok(())
    }
    fn begin_word(&mut self) -> Result<(), pdf_extract::OutputError> {
        Ok(())
    }
    fn end_word(&mut self) -> Result<(), pdf_extract::OutputError> {
        Ok(())
    }
    fn end_line(&mut self) -> Result<(), pdf_extract::OutputError> {
        Ok(())
    }
}

/// The letters on each page of a PDF file.
pub fn read_pages(bytes: &[u8]) -> Result<Vec<Page>, String> {
    let mut doc = pdf_extract::Document::load_mem(bytes).map_err(|e| format!("This file could not be read as a PDF ({e})."))?;
    if doc.is_encrypted() && doc.decrypt("").is_err() {
        return Err("This PDF is locked with a password, so Kolbítar cannot read it. Save an unlocked copy of it and import that.".into());
    }
    repair_to_unicode(&mut doc);
    // A damaged or unusual file must never take the app down with it.
    let run = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut c = Collector::default();
        pdf_extract::output_doc(&doc, &mut c).map(|_| c.pages)
    }));
    match run {
        Ok(Ok(pages)) => Ok(pages),
        Ok(Err(e)) => Err(format!("The text of this PDF could not be read ({e}).")),
        Err(_) => Err("The text of this PDF could not be read: the file uses something Kolbítar's PDF reader does not understand.".into()),
    }
}

/// Character maps (ToUnicode) that give a character beyond U+FFFF as five or
/// six hex digits instead of UTF-16 (printpdf and some other writers do):
/// rewritten as UTF-16 so the reader does not stop at them.
fn repair_to_unicode(doc: &mut pdf_extract::Document) {
    for obj in doc.objects.values_mut() {
        let pdf_extract::Object::Stream(s) = obj else { continue };
        let Ok(content) = s.decompressed_content() else { continue };
        if !content.windows(9).any(|w| w == b"begincmap") {
            continue;
        }
        if let Some(fixed) = utf16_hex(&content) {
            s.dict.remove(b"Filter");
            s.dict.remove(b"DecodeParms");
            s.set_content(fixed);
        }
    }
}

/// `<10efd>` → `<d803defd>` in a character map; None when nothing needed it.
fn utf16_hex(src: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(src.len() + 64);
    let mut changed = false;
    let mut i = 0;
    while i < src.len() {
        if src[i] == b'<' && src.get(i + 1) != Some(&b'<') {
            let mut j = i + 1;
            while j < src.len() && src[j].is_ascii_hexdigit() {
                j += 1;
            }
            let hex = &src[i + 1..j];
            let wide = (j < src.len() && src[j] == b'>' && (hex.len() == 5 || hex.len() == 6)).then(|| std::str::from_utf8(hex).ok().and_then(|h| u32::from_str_radix(h, 16).ok()).and_then(char::from_u32)).flatten();
            if let Some(c) = wide {
                let mut units = [0u16; 2];
                out.push(b'<');
                for u in c.encode_utf16(&mut units) {
                    out.extend_from_slice(format!("{u:04x}").as_bytes());
                }
                out.push(b'>');
                changed = true;
                i = j + 1;
                continue;
            }
            out.extend_from_slice(&src[i..j]);
            i = j;
        } else {
            out.push(src[i]);
            i += 1;
        }
    }
    changed.then_some(out)
}

/// File > Import… for a PDF: the script as best it can be recovered, and a report.
pub fn import(bytes: &[u8], fallback_title: &str) -> Result<Imported, String> {
    let pages = read_pages(bytes)?;
    import_pages(&pages, fallback_title)
}

// ------------------------------------------------------------ lines --

/// A piece of a line: letters with no wide gap between them.
#[derive(Clone, Debug)]
struct Frag {
    x: f64,
    end: f64,
    text: String,
}

#[derive(Clone, Debug)]
struct Row {
    page: usize,
    y: f64,
    size: f64,
    frags: Vec<Frag>,
    /// The row's letters, left to right (x, right edge, letter).
    glyphs: Vec<(f64, f64, String)>,
}

impl Row {
    fn text(&self) -> String {
        self.frags.iter().map(|f| f.text.as_str()).collect::<Vec<_>>().join(" ")
    }
}

/// Letters into rows (by baseline), rows into fragments (split at gaps wider than about three letters).
fn rows_of(page_no: usize, page: &Page) -> Vec<Row> {
    let mut gs: Vec<&Glyph> = page.glyphs.iter().collect();
    gs.sort_by(|a, b| a.y.total_cmp(&b.y).then(a.x.total_cmp(&b.x)));
    let mut rows: Vec<(f64, f64, Vec<&Glyph>)> = Vec::new();
    for g in gs {
        match rows.last_mut() {
            Some((y, size, v)) if (g.y - *y).abs() <= size.max(g.size) * 0.45 => v.push(g),
            _ => rows.push((g.y, g.size, vec![g])),
        }
    }
    let mut out = Vec::new();
    for (y, size, mut v) in rows {
        v.sort_by(|a, b| a.x.total_cmp(&b.x));
        let glyphs: Vec<(f64, f64, String)> = v.iter().map(|g| (g.x, g.x + g.w, g.c.clone())).collect();
        let mut frags = frags_of(&glyphs, size, size * 0.6 * 2.6);
        for f in &mut frags {
            f.text = reading_order(&f.text);
        }
        if !frags.is_empty() {
            out.push(Row { page: page_no, y, size, frags, glyphs });
        }
    }
    out
}

/// Letters into fragments, split where the gap is wider than `split`; a space where words are apart.
fn frags_of(glyphs: &[(f64, f64, String)], size: f64, split: f64) -> Vec<Frag> {
    let mut frags: Vec<Frag> = Vec::new();
    for (x, end, c) in glyphs {
        let blank = c.trim().is_empty();
        match frags.last_mut() {
            Some(f) if x - f.end <= split => {
                let joined_script = f.text.chars().last().is_some_and(is_rtl) && c.chars().next().is_some_and(|ch| is_rtl(ch) || is_mark(ch));
                if !blank && x - f.end > size * if joined_script { 0.6 } else { 0.15 } && !f.text.ends_with(' ') {
                    f.text.push(' ');
                }
                if !(blank && f.text.ends_with(' ')) {
                    f.text.push_str(if blank { " " } else { c });
                }
                f.end = f.end.max(*end);
            }
            _ if blank => {}
            _ => frags.push(Frag { x: *x, end: *end, text: c.clone() }),
        }
    }
    for f in &mut frags {
        f.text = f.text.trim().to_string();
    }
    frags.retain(|f| !f.text.is_empty());
    frags
}

fn is_rtl(c: char) -> bool {
    use unicode_bidi::BidiClass::*;
    matches!(unicode_bidi::bidi_class(c), R | AL)
}

fn is_mark(c: char) -> bool {
    matches!(unicode_bidi::bidi_class(c), unicode_bidi::BidiClass::NSM)
}

/// A PDF keeps right-to-left text in the order it is drawn (left to right on
/// the page). Back to reading order: in a mostly right-to-left line the whole
/// line turns round and its left-to-right runs (numbers, English) turn back;
/// in a left-to-right line only the right-to-left runs turn round.
fn reading_order(t: &str) -> String {
    let chars: Vec<char> = t.chars().collect();
    let rtl = chars.iter().filter(|c| is_rtl(**c)).count();
    if rtl == 0 {
        return t.to_string();
    }
    let ltr = chars.iter().filter(|c| matches!(unicode_bidi::bidi_class(**c), unicode_bidi::BidiClass::L | unicode_bidi::BidiClass::EN)).count();
    // Runs of one direction; neutrals (spaces, punctuation) between two letters of a run join it.
    let strong = |c: char| -> Option<bool> {
        use unicode_bidi::BidiClass::*;
        match unicode_bidi::bidi_class(c) {
            R | AL => Some(true),
            L | EN | AN => Some(false),
            NSM => None,
            _ => None,
        }
    };
    let flip_runs = |cs: &[char], want_rtl: bool| -> Vec<char> {
        let mut out = cs.to_vec();
        let mut i = 0;
        while i < out.len() {
            if strong(out[i]) == Some(want_rtl) {
                let mut j = i + 1;
                let mut last = i;
                while j < out.len() && strong(out[j]) != Some(!want_rtl) {
                    if strong(out[j]) == Some(want_rtl) || is_mark(out[j]) {
                        last = j;
                    }
                    j += 1;
                }
                out[i..=last].reverse();
                i = last + 1;
            } else {
                i += 1;
            }
        }
        out
    };
    if rtl > ltr {
        let mut rev = chars.clone();
        rev.reverse();
        flip_runs(&rev, false).into_iter().map(mirror).collect()
    } else {
        flip_runs(&chars, true).into_iter().collect()
    }
}

/// Brackets drawn in a right-to-left line face the other way in reading order.
fn mirror(c: char) -> char {
    match c {
        '(' => ')',
        ')' => '(',
        '[' => ']',
        ']' => '[',
        _ => c,
    }
}

fn is_caps(t: &str) -> bool {
    t.chars().any(char::is_alphabetic) && !t.chars().any(char::is_lowercase)
}

fn is_heading_text(t: &str) -> bool {
    let u = t.trim_start().to_uppercase();
    ["INT.", "EXT.", "EST.", "INT/EXT", "INT./EXT", "I/E", "INT ", "EXT ", "EST "].iter().any(|p| u.starts_with(p))
}

/// A page or scene number: "12", "12A", "A12", "12.", "3-4".
fn is_number(t: &str) -> bool {
    let t = t.trim().trim_end_matches('.');
    !t.is_empty() && t.len() <= 6 && t.chars().any(|c| c.is_ascii_digit()) && t.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn is_continued(t: &str) -> bool {
    let u = t.trim().to_uppercase();
    u == "(CONTINUED)" || u == "CONTINUED" || u.starts_with("CONTINUED:") || u == "(MORE)"
}

/// The cue without a page-break "(CONT'D)".
fn bare_cue(t: &str) -> String {
    let u = t.trim();
    for s in [" (CONT'D)", " (CONT’D)", " (CONTD)", " (CONT.)", " (CONTINUED)"] {
        if let Some(b) = u.strip_suffix(s) {
            return b.trim().to_string();
        }
    }
    u.to_string()
}

/// Where action starts: the left edge most long lines share (or the leftmost line).
fn action_margin(rows: &[Row], page_w: f64) -> f64 {
    let mut bins: std::collections::BTreeMap<i64, usize> = Default::default();
    for r in rows {
        let f = &r.frags[0];
        if f.end - f.x > page_w * 0.4 && !is_number(&f.text) {
            *bins.entry((f.x / 3.0).round() as i64).or_default() += 1;
        }
    }
    if let Some((b, _)) = bins.iter().max_by_key(|(b, n)| (**n, -**b)) {
        return *b as f64 * 3.0;
    }
    rows.iter().flat_map(|r| r.frags.iter()).filter(|f| !is_number(&f.text)).map(|f| f.x).fold(f64::INFINITY, f64::min)
}

// ------------------------------------------------------------ classify --

#[derive(Default)]
struct Report {
    furniture: usize,
    scene_numbers: Vec<String>,
    unsure: Vec<String>,
    dual: usize,
    joined_pages: usize,
}

/// One line read as an element: what kind, its text, and where it was.
#[derive(Clone, Debug)]
struct Line {
    kind: BlockKind,
    text: String,
    page: usize,
    y: f64,
    size: f64,
    dual: bool,
    /// Carries on the speech from the page before.
    carry: bool,
    number: Option<String>,
}

pub fn import_pages(pages: &[Page], fallback_title: &str) -> Result<Imported, String> {
    if pages.iter().all(|p| p.glyphs.iter().all(|g| g.c.trim().is_empty())) {
        return Err("This PDF has no text to read. It may be a scan or a picture of the pages, which Kolbítar cannot read. Import a PDF exported from a screenwriting app, or the script's Fountain or Final Draft file.".into());
    }
    let page_w = pages.iter().map(|p| p.width).fold(0.0, f64::max).max(1.0);
    let mut per_page: Vec<Vec<Row>> = pages.iter().enumerate().map(|(i, p)| rows_of(i, p)).collect();
    let mut rep = Report::default();

    // Page furniture: lines in the top and bottom margins that are numbers,
    // CONTINUED, or a revision header; (MORE) anywhere.
    for (pi, rows) in per_page.iter_mut().enumerate() {
        let h = pages[pi].height.max(1.0);
        rows.retain(|r| {
            let t = r.text();
            let edge = r.y < 0.9 * 72.0 || r.y > h - 0.75 * 72.0;
            let furniture = (edge && (r.frags.iter().all(|f| is_number(&f.text)) || is_continued(&t) || t.to_uppercase().contains(" REV") || t.to_uppercase().starts_with("REV"))) || t.trim().eq_ignore_ascii_case("(MORE)") || is_continued(&t) && r.frags.len() == 1 && t.to_uppercase().contains("CONTINUED");
            if furniture {
                rep.furniture += 1;
            }
            !furniture
        });
    }

    // A first page with no heading or cue, before a script, is the title page.
    let mut title_page = TitlePage::default();
    if per_page.len() > 1 {
        let all: Vec<Row> = per_page.iter().flatten().cloned().collect();
        let margin = action_margin(&all, page_w);
        let first = &per_page[0];
        let scripty = first.iter().any(|r| {
            let t = r.text();
            is_heading_text(&t) || (is_caps(&t) && ((r.frags[0].x - margin) / 72.0) > 1.85 && ((r.frags[0].x - margin) / 72.0) < 3.2 && per_page[0].len() > 12)
        });
        if !first.is_empty() && !scripty {
            title_page = read_title_page(first, pages[0].height, page_w);
            per_page[0].clear();
        }
    }

    let rows: Vec<Row> = per_page.into_iter().flatten().collect();
    let margin = action_margin(&rows, page_w);
    let d_of = |x: f64| (x - margin) / 72.0;

    // Rows into lines: scene numbers out of the margins, dual columns apart.
    let mut lines: Vec<Line> = Vec::new();
    let mut i = 0;
    let mut in_paren = false;
    let mut more_pending = false;
    let mut carrying = false;
    let mut last_cue = String::new();
    let mut prev_page = usize::MAX;
    while i < rows.len() {
        let r = &rows[i];
        let mut frags = r.frags.clone();
        let mut number = None;
        // Scene numbers sit left of the action margin or far to the right.
        if frags.len() > 1 {
            let n0 = &frags[0];
            if is_number(&n0.text) && n0.x < margin - 6.0 {
                number = Some(n0.text.trim_end_matches('.').to_string());
                frags.remove(0);
            }
            if frags.len() > 1 && frags.last().is_some_and(|l| is_number(&l.text) && l.x > margin + 5.2 * 72.0) {
                let last = frags.pop().unwrap();
                number = number.or(Some(last.text.trim_end_matches('.').to_string()));
            }
        }
        // Two speeches side by side: both columns start right of the margin.
        if frags.len() >= 2 && d_of(frags[0].x) > 0.3 && frags.iter().all(|f| !is_number(&f.text)) && is_caps(&frags[0].text) && is_caps(&frags[1].text) {
            // The block of rows that holds the two speeches.
            let mut j = i;
            let mut last_y = r.y;
            // The speeches end at the blank line after them.
            while j < rows.len() && rows[j].page == r.page && rows[j].y - last_y <= rows[j].size * 1.6 {
                last_y = rows[j].y;
                j += 1;
            }
            // Each column's cue sits the same way in from the column's edge, so the
            // right column starts where the left cue's inset, taken from the right cue, says.
            let left_edge = rows[i..j].iter().map(|rr| rr.frags[0].x).fold(f64::INFINITY, f64::min);
            let right_edge = frags[1].x - (frags[0].x - left_edge) - r.size * 0.3;
            let mut left: Vec<Row> = Vec::new();
            let mut right: Vec<Row> = Vec::new();
            for rr in &rows[i..j] {
                let (l, rt): (Vec<_>, Vec<_>) = rr.glyphs.iter().cloned().partition(|g| g.0 < right_edge);
                for (side, out) in [(l, &mut left), (rt, &mut right)] {
                    let mut fs = frags_of(&side, rr.size, f64::INFINITY);
                    for f in &mut fs {
                        f.text = reading_order(&f.text);
                    }
                    if !fs.is_empty() {
                        out.push(Row { frags: fs, glyphs: side, ..rr.clone() });
                    }
                }
            }
            for (col, is_right) in [(left, false), (right, true)] {
                for (k, rr) in col.iter().enumerate() {
                    let t = rr.text();
                    let kind = if k == 0 && is_caps(&t) {
                        BlockKind::Character
                    } else if t.starts_with('(') || (in_paren && !t.starts_with('(')) && lines.last().is_some_and(|l| l.kind == BlockKind::Parenthetical && !l.text.ends_with(')')) {
                        BlockKind::Parenthetical
                    } else {
                        BlockKind::Dialogue
                    };
                    in_paren = kind == BlockKind::Parenthetical && !t.ends_with(')');
                    lines.push(Line { kind, text: t, page: rr.page, y: rr.y, size: rr.size, dual: is_right && k == 0, carry: false, number: None });
                }
            }
            rep.dual += 1;
            i = j;
            continue;
        }
        let t = frags.iter().map(|f| f.text.as_str()).collect::<Vec<_>>().join(" ");
        let d = d_of(frags[0].x);
        let prev = lines.last().map(|l| l.kind);
        let in_speech = carrying || matches!(prev, Some(BlockKind::Character | BlockKind::Dialogue | BlockKind::Parenthetical)) && lines.last().is_some_and(|l| r.page == l.page && r.y - l.y <= r.size * 1.6);
        let caps = is_caps(&t);
        // A long heading wraps onto a second line at the same margin.
        let heading_goes_on = lines.last().is_some_and(|l| l.kind == BlockKind::Heading && l.page == r.page && r.y - l.y <= r.size * 1.45);
        let kind = if (is_heading_text(&t) || heading_goes_on && caps) && d < 0.6 {
            BlockKind::Heading
        } else if caps && (t.ends_with("TO:") || t.ends_with("TO BLACK.") || t == "FADE OUT." || t == "FADE OUT") && (d > 2.5 || t.ends_with("TO:")) {
            BlockKind::Transition
        } else if d < 0.5 {
            BlockKind::Action
        } else if caps && d >= 3.2 {
            BlockKind::Transition
        } else if (t.starts_with('(') || in_paren) && (1.1..2.2).contains(&d) && in_speech {
            BlockKind::Parenthetical
        } else if caps && (1.8..3.2).contains(&d) {
            BlockKind::Character
        } else if (0.5..1.8).contains(&d) && in_speech {
            BlockKind::Dialogue
        } else {
            rep.unsure.push(t.clone());
            BlockKind::Action
        };
        in_paren = kind == BlockKind::Parenthetical && !t.trim_end().ends_with(')');
        // A speech carried over a page break: the repeated cue goes, the speech joins up.
        if kind == BlockKind::Character && r.page != prev_page && more_pending && bare_cue(&t) == last_cue {
            more_pending = false;
            carrying = true;
            rep.joined_pages += 1;
            prev_page = r.page;
            i += 1;
            continue;
        }
        if kind == BlockKind::Character {
            last_cue = bare_cue(&t);
        }
        let carry = carrying && matches!(kind, BlockKind::Dialogue | BlockKind::Parenthetical);
        carrying = false;
        lines.push(Line { kind, text: t, page: r.page, y: r.y, size: r.size, dual: false, carry, number });
        prev_page = r.page;
        i += 1;
        // (MORE) was dropped with the furniture; a speech that reaches the foot of a page is carried on.
        let h = pages[r.page].height;
        more_pending = matches!(kind, BlockKind::Dialogue | BlockKind::Parenthetical) && rows.get(i).is_none_or(|n| n.page != r.page) && r.y > h * 0.6;
    }

    // Lines into blocks: wrapped lines of one paragraph join with spaces.
    let mut blocks: Vec<Block> = Vec::new();
    let mut scene_numbers = Vec::new();
    let mut last: Option<Line> = None;
    for l in lines {
        let joins = last.as_ref().is_some_and(|p| {
            p.kind == l.kind && matches!(l.kind, BlockKind::Action | BlockKind::Dialogue | BlockKind::Parenthetical | BlockKind::Heading) && (l.carry || (p.page == l.page && l.y - p.y <= l.size * 1.45))
        });
        if joins && !l.dual {
            let b = blocks.last_mut().unwrap();
            let mut text = b.text();
            if !text.ends_with('-') || text.ends_with(" -") {
                text.push(' ');
            }
            text.push_str(&l.text);
            *b = Block { runs: vec![crate::model::Run::plain(text)], ..b.clone() };
        } else {
            let mut b = Block::new(l.kind, l.text.clone());
            b.dual = l.dual;
            if let (Some(n), Some(id)) = (&l.number, &b.scene_id) {
                scene_numbers.push((id.clone(), n.clone()));
                rep.scene_numbers.push(n.clone());
            }
            blocks.push(b);
        }
        last = Some(l);
    }
    if blocks.is_empty() {
        return Err("No script text was found in this PDF.".into());
    }

    let plural = |n: usize| if n == 1 { "" } else { "s" };
    let count = |k: BlockKind| blocks.iter().filter(|b| b.kind == k).count();
    let mut notes = vec![format!(
        "Read from a PDF: {} page{}, {} scene{}, {} speech{}. A PDF does not say what kind of paragraph each line is, so every element was guessed from where it sits on the page. Check the script, especially scene headings, cues and transitions.",
        pages.len(),
        plural(pages.len()),
        count(BlockKind::Heading),
        plural(count(BlockKind::Heading)),
        count(BlockKind::Character),
        if count(BlockKind::Character) == 1 { "" } else { "es" }
    )];
    if !title_page.is_empty() {
        notes.push("The first page was read as the title page; check its fields in File > Title Page….".into());
    }
    if !rep.scene_numbers.is_empty() {
        notes.push(format!("{} scene number{} kept and locked ({}).", rep.scene_numbers.len(), plural(rep.scene_numbers.len()), rep.scene_numbers.join(", ")));
    }
    if rep.furniture > 0 {
        notes.push(format!("{} line{} of page furniture left out (page numbers, (MORE), CONTINUED, revision headers); Kolbítar adds its own when it prints.", rep.furniture, plural(rep.furniture)));
    }
    if rep.joined_pages > 0 {
        notes.push(format!("{} speech{} carried over a page break joined up again.", rep.joined_pages, if rep.joined_pages == 1 { "" } else { "es" }));
    }
    if rep.dual > 0 {
        notes.push(format!("{} pair{} of speeches side by side read as dual dialogue.", rep.dual, plural(rep.dual)));
    }
    if !rep.unsure.is_empty() {
        let shown: Vec<String> = rep.unsure.iter().take(5).map(|t| format!("\u{201c}{}\u{201d}", t.chars().take(60).collect::<String>())).collect();
        notes.push(format!("{} line{} did not sit where any element usually does and became action: {}{}.", rep.unsure.len(), plural(rep.unsure.len()), shown.join(", "), if rep.unsure.len() > 5 { ", …" } else { "" }));
    }
    if blocks.iter().any(|b| b.text().chars().any(is_rtl)) {
        notes.push("Hebrew or Arabic text was found. A PDF keeps it in the order it is drawn, so it was turned back into reading order; Arabic letters may come in as their joined display forms. Check those lines.".into());
    }
    notes.push("Chinese, Japanese and Korean, emoji, and any other characters the PDF did not print cannot be recovered from it.".into());
    notes.push("Bold, italic and underlining are not read from PDFs.".into());
    let title = if title_page.title.trim().is_empty() { fallback_title.to_string() } else { title_page.title.lines().next().unwrap_or("").trim().to_string() };
    Ok(Imported { document: Document { title, version: 0, blocks }, title_page, scene_numbers, notes })
}

/// A title page: the title (the first lines), the credit and authors, a
/// "based on" source, contact at the foot on the left and the draft on the right.
fn read_title_page(rows: &[Row], height: f64, width: f64) -> TitlePage {
    let mut tp = TitlePage::default();
    let foot = height * 0.7;
    // The foot of the page: contact on the left, the draft on the right.
    for r in rows.iter().filter(|r| r.y > foot) {
        for f in &r.frags {
            let field = if f.x > width * 0.45 { &mut tp.draft_label } else { &mut tp.contact };
            if !field.is_empty() {
                field.push('\n');
            }
            field.push_str(&f.text);
        }
    }
    let mut groups: Vec<Vec<&Row>> = Vec::new();
    for r in rows.iter().filter(|r| r.y <= foot) {
        match groups.last_mut() {
            Some(g) if r.y - g.last().unwrap().y <= r.size * 1.6 => g.push(r),
            _ => groups.push(vec![r]),
        }
    }
    let mut authors_next = false;
    let mut title_done = false;
    for g in groups {
        let text: Vec<String> = g.iter().map(|r| r.text()).collect();
        let joined = text.join("\n");
        let low = joined.to_lowercase();
        if !title_done {
            tp.title = joined;
            title_done = true;
        } else if low.ends_with(" by") || low == "by" {
            tp.credit = joined;
            authors_next = true;
        } else if authors_next {
            tp.authors = joined;
            authors_next = false;
        } else if low.contains("based on") || !tp.source.is_empty() && tp.authors.is_empty() {
            tp.source = if tp.source.is_empty() { joined } else { format!("{}\n{joined}", tp.source) };
        } else if tp.authors.is_empty() && tp.credit.is_empty() {
            // "Written by Ada Lovelace" on one line.
            if let Some(at) = low.find(" by ") {
                tp.credit = joined[..at + 3].trim().to_string();
                tp.authors = joined[at + 4..].trim().to_string();
            } else {
                tp.notes = if tp.notes.is_empty() { joined } else { format!("{}\n{joined}", tp.notes) };
            }
        } else {
            tp.notes = if tp.notes.is_empty() { joined } else { format!("{}\n{joined}", tp.notes) };
        }
    }
    tp
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A line of Courier at 12 pt: one glyph per letter, 7.2 pt apart.
    fn line(p: &mut Page, x_in: f64, y_in: f64, text: &str) {
        for (i, c) in text.chars().enumerate() {
            p.glyphs.push(Glyph { x: x_in * 72.0 + i as f64 * 7.2, y: y_in * 72.0, w: 7.2, size: 12.0, c: c.to_string() });
        }
    }
    fn page() -> Page {
        Page { width: 612.0, height: 792.0, glyphs: Vec::new() }
    }

    #[test]
    fn character_maps_beyond_the_basic_plane_are_repaired() {
        assert_eq!(utf16_hex(b"<01dc> <10efd>\n<0003> <0020>").unwrap(), b"<01dc> <d803defd>\n<0003> <0020>".to_vec());
        assert_eq!(utf16_hex(b"<0003> <0020>"), None, "a valid map is left alone");
    }

    #[test]
    fn elements_come_from_where_lines_sit() {
        let mut p = page();
        line(&mut p, 7.4, 0.5, "1.");
        line(&mut p, 0.9, 1.0, "12");
        line(&mut p, 1.5, 1.0, "INT. COUNTING HOUSE - NIGHT");
        line(&mut p, 7.2, 1.0, "12");
        line(&mut p, 1.5, 1.33, "Ines counts the coins. She counts them twice, and then a");
        line(&mut p, 1.5, 1.5, "third time.");
        line(&mut p, 3.7, 1.83, "INES");
        line(&mut p, 3.1, 2.0, "(quietly)");
        line(&mut p, 2.5, 2.17, "One short. Always one short. Someone");
        line(&mut p, 2.5, 2.33, "is skimming.");
        line(&mut p, 6.0, 2.67, "CUT TO:");
        let r = import_pages(&[p], "Fallback").unwrap();
        let kinds: Vec<(BlockKind, String)> = r.document.blocks.iter().map(|b| (b.kind, b.text())).collect();
        assert_eq!(
            kinds,
            vec![
                (BlockKind::Heading, "INT. COUNTING HOUSE - NIGHT".into()),
                (BlockKind::Action, "Ines counts the coins. She counts them twice, and then a third time.".into()),
                (BlockKind::Character, "INES".into()),
                (BlockKind::Parenthetical, "(quietly)".into()),
                (BlockKind::Dialogue, "One short. Always one short. Someone is skimming.".into()),
                (BlockKind::Transition, "CUT TO:".into()),
            ]
        );
        assert_eq!(r.scene_numbers.len(), 1);
        assert_eq!(r.scene_numbers[0].1, "12");
        assert_eq!(r.document.title, "Fallback");
        assert!(r.notes.iter().any(|n| n.contains("page furniture")), "the page number is left out: {:?}", r.notes);
    }

    #[test]
    fn a_speech_over_a_page_break_joins_up_and_dual_dialogue_is_read() {
        let mut a = page();
        line(&mut a, 1.5, 1.0, "EXT. HARBOUR - DAWN");
        line(&mut a, 3.7, 9.6, "PELL");
        line(&mut a, 2.5, 9.77, "The tide will not wait for");
        line(&mut a, 3.7, 9.94, "(MORE)");
        let mut b = page();
        line(&mut b, 7.4, 0.5, "2.");
        line(&mut b, 3.7, 1.0, "PELL (CONT'D)");
        line(&mut b, 2.5, 1.17, "any of us.");
        line(&mut b, 1.5, 1.5, "Gulls wheel overhead.");
        line(&mut b, 2.4, 1.83, "MARGIT");
        line(&mut b, 5.0, 1.83, "TOBIAS");
        line(&mut b, 1.9, 2.0, "Now?");
        line(&mut b, 4.5, 2.0, "Not yet.");
        line(&mut b, 1.5, 2.5, "They wait.");
        let r = import_pages(&[a, b], "Harbour").unwrap();
        let kinds: Vec<(BlockKind, String, bool)> = r.document.blocks.iter().map(|b| (b.kind, b.text(), b.dual)).collect();
        assert_eq!(
            kinds,
            vec![
                (BlockKind::Heading, "EXT. HARBOUR - DAWN".into(), false),
                (BlockKind::Character, "PELL".into(), false),
                (BlockKind::Dialogue, "The tide will not wait for any of us.".into(), false),
                (BlockKind::Action, "Gulls wheel overhead.".into(), false),
                (BlockKind::Character, "MARGIT".into(), false),
                (BlockKind::Dialogue, "Now?".into(), false),
                (BlockKind::Character, "TOBIAS".into(), true),
                (BlockKind::Dialogue, "Not yet.".into(), false),
                (BlockKind::Action, "They wait.".into(), false),
            ]
        );
        assert!(r.notes.iter().any(|n| n.contains("carried over a page break")), "{:?}", r.notes);
        assert!(r.notes.iter().any(|n| n.contains("dual dialogue")), "{:?}", r.notes);
    }

    #[test]
    fn a_title_page_fills_the_title_page_and_empty_or_scanned_pdfs_are_refused() {
        let mut t = page();
        line(&mut t, 3.2, 3.5, "THE OBSIDIAN SEAL");
        line(&mut t, 3.8, 4.2, "Written by");
        line(&mut t, 3.6, 4.6, "Ada Quill");
        line(&mut t, 1.5, 9.5, "ada@example.com");
        line(&mut t, 5.5, 9.5, "First Draft");
        let mut s = page();
        line(&mut s, 1.5, 1.0, "INT. VAULT - NIGHT");
        line(&mut s, 1.5, 1.33, "Dust.");
        let r = import_pages(&[t, s], "Seal").unwrap();
        assert_eq!(r.title_page.title, "THE OBSIDIAN SEAL");
        assert_eq!(r.title_page.credit, "Written by");
        assert_eq!(r.title_page.authors, "Ada Quill");
        assert_eq!(r.title_page.contact, "ada@example.com");
        assert_eq!(r.title_page.draft_label, "First Draft");
        assert_eq!(r.document.title, "THE OBSIDIAN SEAL");
        assert_eq!(r.document.blocks[0].text(), "INT. VAULT - NIGHT");
        // A scan: pages with no letters on them.
        let err = import_pages(&[page(), page()], "Scan").unwrap_err();
        assert!(err.contains("no text"), "{err}");
        assert!(import(b"not a pdf", "x").unwrap_err().contains("could not be read as a PDF"));
    }

    /// Kolbítar's own PDF of a fixture, read back: (kind, text with spaces evened out, dual).
    fn round_trip(fixture: crate::fixtures::Fixture, tp: Option<&TitlePage>) -> (Vec<(BlockKind, String, bool)>, Vec<(BlockKind, String, bool)>, Imported) {
        let p = crate::layout::Profile::us_letter();
        let doc = fixture.to_document().unwrap();
        let map = crate::layout::paginate(&doc.blocks, &p, 1);
        let opts = crate::pdf::PdfOptions { title: "t".into(), date_unix: 1_790_000_000, document_id: "t".into(), ..Default::default() };
        let bytes = crate::pdf::render_document(&map, &p, tp, &opts).unwrap();
        let r = import(&bytes, "Fallback").unwrap();
        let even = |t: String| t.split_whitespace().collect::<Vec<_>>().join(" ");
        let want = doc.blocks.iter().filter(|b| !b.text().trim().is_empty()).map(|b| (if b.kind == BlockKind::Lyric { BlockKind::Dialogue } else { b.kind }, even(b.text()), b.dual)).collect();
        let got = r.document.blocks.iter().map(|b| (b.kind, even(b.text()), b.dual)).collect();
        (got, want, r)
    }

    #[test]
    fn our_own_pdf_reads_back_as_the_same_script() {
        // Page breaks inside speeches, (MORE) and (CONT'D), a wrapped heading, dual dialogue.
        let (got, want, r) = round_trip(crate::fixtures::page_boundaries(), None);
        assert_eq!(got, want);
        assert!(r.notes.iter().any(|n| n.contains("dual dialogue")) && r.notes.iter().any(|n| n.contains("page break")), "{:?}", r.notes);
        // With a title page in front: its fields come back and the script starts after it.
        let tp = TitlePage { title: "THE LEDGER".into(), credit: "Written by".into(), authors: "Ines Varga".into(), contact: "ines@example.com".into(), draft_label: "Second Draft".into(), ..Default::default() };
        let (got, want, r) = round_trip(crate::fixtures::page_boundaries(), Some(&tp));
        assert_eq!(got, want);
        assert_eq!((r.title_page.title.as_str(), r.title_page.credit.as_str(), r.title_page.authors.as_str()), ("THE LEDGER", "Written by", "Ines Varga"));
        assert_eq!((r.title_page.contact.as_str(), r.title_page.draft_label.as_str()), ("ines@example.com", "Second Draft"));
        assert_eq!(r.document.title, "THE LEDGER");
    }
    #[test]
    fn right_to_left_text_comes_back_in_reading_order() {
        // Drawn order (as a PDF keeps it) to reading order.
        assert_eq!(reading_order("Right-to-left sample: םולש and more"), "Right-to-left sample: שלום and more");
        assert_eq!(reading_order(".42 ןכודה תא שפחמ ינא !םולש"), "שלום! אני מחפש את הדוכן 42.");
        assert_eq!(reading_order("plain English"), "plain English");
        // Our own PDF with Hebrew, Arabic and Devanagari (fonts whose maps reach past U+FFFF).
        let (got, _, r) = round_trip(crate::fixtures::unicode_marks(), None);
        let all: String = got.iter().map(|g| g.1.clone()).collect::<Vec<_>>().join("\n");
        assert!(all.contains("Right-to-left sample: שלום and"), "{all}");
        assert!(r.notes.iter().any(|n| n.contains("Hebrew or Arabic")), "{:?}", r.notes);
        assert!(got.iter().any(|g| g.0 == BlockKind::Character && g.1 == "ABENA"));
    }
}
