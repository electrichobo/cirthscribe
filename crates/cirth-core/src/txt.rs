//! Plain-text export: the authoritative page map written as fixed-pitch text,
//! so the text file has the same line breaks, indents, (MORE)/(CONT'D) and
//! page breaks as the PDF. Columns count from the action margin; pages are
//! separated by a form feed and numbered like the PDF from page 2.
//!
//! Plain text cannot carry bold, italic or underline, exact margins, or the
//! font; `Exported::notes` says what was left out so the UI can tell the user.

use crate::layout::{PageMap, Profile};
use serde::Serialize;
use unicode_width::UnicodeWidthStr;

#[derive(Debug, Serialize)]
pub struct Exported {
    pub text: String,
    pub pages: usize,
    /// What plain text could not keep (shown to the user after export).
    pub notes: Vec<String>,
}

pub fn render(map: &PageMap, p: &Profile) -> Exported {
    render_with_title(map, p, None)
}

/// Like `render`, with a title page first (then a form feed) when one is
/// given and not empty. Page numbers are unchanged: the title page is unnumbered.
pub fn render_with_title(map: &PageMap, p: &Profile, title_page: Option<&crate::title::TitlePage>) -> Exported {
    // Columns count from the action margin, or from the left scene numbers
    // when the script has them (they sit in the left margin).
    let origin = map.pages.iter().flat_map(|pg| pg.lines.iter().map(|l| l.x_in)).fold(p.action.left_in, f32::min);
    let col = |x_in: f32| ((x_in - origin) * p.chars_per_inch).round().max(0.0) as usize;
    // Page numbers end where the PDF's do: 1 inch from the right edge.
    let right = col(p.page_w_in - 1.0);
    let mut out = String::new();
    if let Some(tp) = title_page.filter(|t| !t.is_empty()) {
        let lines = crate::title::layout(tp, p);
        let rows = lines.iter().map(|l| l.row + 1).max().unwrap_or(0);
        let mut grid = vec![String::new(); rows];
        for l in lines {
            let row = &mut grid[l.row];
            let at = col(l.x_in);
            let used = UnicodeWidthStr::width(row.as_str());
            row.push_str(&" ".repeat(at.saturating_sub(used).max(if used > 0 { 1 } else { 0 })));
            row.push_str(&l.text);
        }
        for r in grid {
            out.push_str(r.trim_end());
            out.push('\n');
        }
        out.push('\u{c}');
        out.push('\n');
    }
    let mut styled = 0usize;
    for (i, page) in map.pages.iter().enumerate() {
        if i > 0 {
            out.push('\u{c}');
            out.push('\n');
        }
        if page.number > 1 {
            let label = format!("{}.", page.number);
            out.push_str(&" ".repeat(right.saturating_sub(label.len())));
            out.push_str(&label);
            out.push_str("\n\n");
        }
        let rows = page.lines.iter().map(|l| l.row + 1).max().unwrap_or(0);
        let mut grid: Vec<String> = vec![String::new(); rows];
        let mut lines: Vec<_> = page.lines.iter().collect();
        lines.sort_by(|a, b| a.row.cmp(&b.row).then(a.x_in.total_cmp(&b.x_in)));
        for l in lines {
            let row = &mut grid[l.row];
            let at = col(l.x_in);
            let used = UnicodeWidthStr::width(row.as_str());
            if used < at {
                row.push_str(&" ".repeat(at - used));
            } else if used > 0 {
                // Never let two pieces run together (should not happen).
                row.push(' ');
            }
            for s in &l.segs {
                styled += (s.bold || s.italic || s.underline) as usize;
                row.push_str(&s.text);
            }
        }
        for r in grid {
            out.push_str(r.trim_end());
            out.push('\n');
        }
    }
    let mut notes = vec![
        "Plain text keeps the words, line breaks, indents and page breaks of the PDF layout. It cannot keep the font or exact margins.".to_string(),
        "Pages are separated by a form feed character; page numbers start on page 2.".to_string(),
    ];
    if styled > 0 {
        notes.push(format!("Bold, italic and underline were removed ({styled} styled passages)."));
    }
    notes.extend(map.warnings.iter().map(|w| format!("Layout: {w}")));
    Exported { text: out, pages: map.pages.len(), notes }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixtures;
    use crate::layout::{paginate, Profile};

    #[test]
    fn same_pages_and_lines_as_the_page_map() {
        let doc = fixtures::long_script(120).to_document().unwrap();
        let p = Profile::us_letter();
        let map = paginate(&doc.blocks, &p, 1);
        let t = render(&map, &p);
        assert_eq!(t.text.matches('\u{c}').count() + 1, map.pages.len());
        // Every laid-out line appears, in order, at its column.
        let mut rest = t.text.as_str();
        for page in &map.pages {
            for l in &page.lines {
                let text: String = l.segs.iter().map(|s| s.text.as_str()).collect();
                let i = rest.find(text.as_str()).unwrap_or_else(|| panic!("missing {text:?}"));
                rest = &rest[i + text.len()..];
            }
        }
        // Action starts at column 0, cues at 22, dialogue at 10.
        let first = |kind: &str| map.pages.iter().flat_map(|p| &p.lines).find(|l| l.kind == kind && !l.synthetic).unwrap();
        for (kind, column) in [("action", 0), ("character", 22), ("dialogue", 10)] {
            let l = first(kind);
            let text: String = l.segs.iter().map(|s| s.text.as_str()).collect();
            assert!(t.text.lines().any(|line| line.len() >= column && line[column..].starts_with(&text) && line[..column].trim().is_empty()), "{kind} at column {column}");
        }
        // "2." ends at column 60 (6 inches of text at 10 characters per inch).
        assert!(t.text.contains(&format!("\n{}2.\n", " ".repeat(58))), "page number");
    }

    #[test]
    fn styles_dual_dialogue_and_wide_text() {
        let doc = fixtures::unicode_marks().to_document().unwrap();
        let p = Profile::a4();
        let map = paginate(&doc.blocks, &p, 1);
        let t = render(&map, &p);
        assert!(t.notes.iter().any(|n| n.starts_with("Bold, italic and underline were removed")));
        let doc = fixtures::page_boundaries().to_document().unwrap();
        let map = paginate(&doc.blocks, &p, 1);
        let t = render(&map, &p);
        // Dual dialogue: two cues share one line.
        let dual: Vec<_> = map.pages.iter().flat_map(|p| &p.lines).filter(|l| l.kind == "character" && l.x_in > 4.0).collect();
        assert!(!dual.is_empty(), "fixture has dual dialogue");
        let right: String = dual[0].segs.iter().map(|s| s.text.as_str()).collect();
        let line = t.text.lines().find(|l| l.contains(&right)).unwrap();
        assert!(line.trim_start().len() > right.len() + 2, "left cue on the same line: {line:?}");
    }

    #[test]
    fn title_page_comes_first_and_page_numbers_are_unchanged() {
        let p = Profile::us_letter();
        let doc = crate::fixtures::page_boundaries().to_document().unwrap();
        let map = crate::layout::paginate(&doc.blocks, &p, 1);
        let plain = render(&map, &p);
        let tp = crate::title::TitlePage { title: "THE TIDE LEDGER".into(), contact: "jared@example.invalid".into(), ..Default::default() };
        let with = render_with_title(&map, &p, Some(&tp));
        let (title_page, rest) = with.text.split_once("\u{c}\n").unwrap();
        assert_eq!(rest, plain.text, "script pages unchanged after the title page");
        let t = title_page.lines().find(|l| l.contains("THE TIDE LEDGER")).unwrap();
        // Centred on the 60-column text area (columns count from the action margin).
        let indent = t.len() - t.trim_start().len();
        assert!((22..=23).contains(&indent), "centred: {indent} {t:?}");
        assert!(title_page.trim_end().ends_with("jared@example.invalid"), "contact on the last line");
        assert_eq!(render_with_title(&map, &p, Some(&Default::default())).text, plain.text, "empty title page: none printed");
    }
}
