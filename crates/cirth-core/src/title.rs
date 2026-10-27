//! Title page: authored fields stored per document (settings scope
//! `document:<id>`, key `title_page`, as JSON), and their placement on the
//! page. PDF and plain-text export both draw from `layout`, so they agree.
//!
//! Placement follows the common US screenplay title page: title, credit,
//! authors and source centred about a third of the way down; contact details
//! bottom left; draft label, draft date, WGA registration and notes bottom
//! right. The title page is not counted as a script page and has no number.

use crate::layout::Profile;
use serde::{Deserialize, Serialize};
use unicode_width::UnicodeWidthStr;

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct TitlePage {
    pub title: String,
    /// e.g. "Written by", "Screenplay by".
    pub credit: String,
    /// One name per line.
    pub authors: String,
    /// e.g. "Based on the novel by …" (may be several lines).
    pub source: String,
    /// e.g. "Second Draft", "Blue Revision".
    pub draft_label: String,
    pub draft_date: String,
    /// Address, phone, email, agent: one item per line.
    pub contact: String,
    /// WGA registration number, as the writer types it.
    pub wga: String,
    pub notes: String,
}

impl TitlePage {
    /// A title page is printed only when it has a title.
    pub fn is_empty(&self) -> bool {
        self.title.trim().is_empty()
    }
}

/// One placed line: `row` counts from the top margin, like page lines.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct TitleLine {
    pub row: usize,
    pub x_in: f32,
    pub text: String,
}

/// Split on newlines and wrap each line to `width` columns at spaces.
fn wrap(text: &str, width: usize) -> Vec<String> {
    let mut out = Vec::new();
    for para in text.lines().map(str::trim).filter(|l| !l.is_empty()) {
        let mut line = String::new();
        for word in para.split_whitespace() {
            if !line.is_empty() && UnicodeWidthStr::width(line.as_str()) + 1 + UnicodeWidthStr::width(word) > width {
                out.push(std::mem::take(&mut line));
            }
            if !line.is_empty() {
                line.push(' ');
            }
            line.push_str(word);
        }
        if !line.is_empty() {
            out.push(line);
        }
    }
    out
}

pub fn layout(tp: &TitlePage, p: &Profile) -> Vec<TitleLine> {
    let char_in = 1.0 / p.chars_per_inch;
    let rows = ((p.page_h_in - p.top_in - p.bottom_in) * p.lines_per_inch).floor() as usize;
    let (left, right) = (p.action.left_in, p.page_w_in - 1.0);
    let cols = ((right - left) * p.chars_per_inch) as usize;
    let w = |t: &str| UnicodeWidthStr::width(t) as f32 * char_in;
    let mut out = Vec::new();

    // Centre block, starting about a third of the way down.
    let mut row = rows * 3 / 10;
    let mut centre = |text: &str, row: &mut usize, gap_before: bool| {
        let lines = wrap(text, cols);
        if lines.is_empty() {
            return;
        }
        if gap_before {
            *row += 1; // one blank line between blocks
        }
        for l in lines {
            let x = left + ((right - left) - w(&l)) / 2.0;
            out.push(TitleLine { row: *row, x_in: x, text: l });
            *row += 1;
        }
    };
    centre(&tp.title, &mut row, false);
    centre(&tp.credit, &mut row, true);
    centre(&tp.authors, &mut row, true);
    centre(&tp.source, &mut row, true);

    // Bottom corners, ending on the last line of the page.
    let half = cols / 2 - 2;
    let contact = wrap(&tp.contact, half);
    for (i, l) in contact.iter().enumerate() {
        out.push(TitleLine { row: rows - contact.len() + i, x_in: left, text: l.clone() });
    }
    let wga = tp.wga.trim();
    let wga = if wga.is_empty() || wga.to_uppercase().contains("WGA") { wga.to_string() } else { format!("WGA Registration No. {wga}") };
    let corner: Vec<String> = [tp.draft_label.as_str(), tp.draft_date.as_str(), wga.as_str(), tp.notes.as_str()].iter().flat_map(|t| wrap(t, half)).collect();
    for (i, l) in corner.iter().enumerate() {
        out.push(TitleLine { row: rows - corner.len() + i, x_in: right - w(l), text: l.clone() });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn places_the_blocks_and_wraps_long_lines() {
        let p = Profile::us_letter();
        let tp = TitlePage {
            title: "THE TIDE LEDGER".into(),
            credit: "Written by".into(),
            authors: "Jared Hoy\nA. N. Other".into(),
            source: "Based on a story that is far too long to fit on one line of a title page, so it wraps".into(),
            draft_label: "Second Draft".into(),
            draft_date: "27 October 2026".into(),
            contact: "jared@example.invalid\n555 0100".into(),
            wga: "1234567".into(),
            notes: String::new(),
        };
        let lines = layout(&tp, &p);
        let at = |t: &str| lines.iter().find(|l| l.text.starts_with(t)).unwrap_or_else(|| panic!("{t} missing: {lines:?}"));
        let title = at("THE TIDE LEDGER");
        // Centred on the text column (1.5 in to 7.5 in).
        assert!((title.x_in + 15.0 * 0.1 / 2.0 - 4.5).abs() < 0.06, "{}", title.x_in);
        assert!(at("Written by").row == title.row + 2 && at("Jared Hoy").row == title.row + 4 && at("A. N. Other").row == title.row + 5);
        let source: Vec<_> = lines.iter().filter(|l| l.row > at("A. N. Other").row && l.x_in < 7.0 && l.x_in > 1.5).collect();
        assert!(source.len() >= 2 && source.iter().all(|l| l.text.chars().count() <= 60), "source wraps: {source:?}");
        // Bottom corners end on the last line; WGA gets its label.
        let last = ((p.page_h_in - p.top_in - p.bottom_in) * p.lines_per_inch).floor() as usize - 1;
        assert_eq!(at("555 0100").row, last);
        assert_eq!(at("555 0100").x_in, p.action.left_in);
        let wga = at("WGA Registration No. 1234567");
        assert_eq!(wga.row, last);
        assert!((wga.x_in + wga.text.chars().count() as f32 * 0.1 - 7.5).abs() < 1e-4, "right-aligned");
        assert!(TitlePage::default().is_empty() && !tp.is_empty());
    }
}
