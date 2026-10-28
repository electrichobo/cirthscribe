//! PDF output. Draws exactly the lines in a `PageMap`; it does no line
//! breaking of its own. Fonts are embedded so text stays selectable.
//!
//! The same script and options always give the same bytes: the date and
//! document id come from `PdfOptions`, and the random "instance id" that
//! printpdf writes into the trailer is replaced by the document id (same
//! length, so no offsets move). Header and footer lines, like page numbers,
//! start on page 2.

use crate::layout::{PageMap, Profile};
use printpdf::{IndirectFontRef, Line, Mm, PdfDocument, Point};
use std::io::{BufWriter, Cursor};

pub static REGULAR: &[u8] = include_bytes!("../../../assets/fonts/courier-prime/CourierPrime-Regular.ttf");
pub static BOLD: &[u8] = include_bytes!("../../../assets/fonts/courier-prime/CourierPrime-Bold.ttf");
pub static ITALIC: &[u8] = include_bytes!("../../../assets/fonts/courier-prime/CourierPrime-Italic.ttf");
pub static BOLD_ITALIC: &[u8] = include_bytes!("../../../assets/fonts/courier-prime/CourierPrime-BoldItalic.ttf");

fn mm(inches: f32) -> Mm {
    Mm(inches * 25.4)
}

pub fn render(map: &PageMap, p: &Profile, title: &str) -> Result<Vec<u8>, String> {
    render_with_title(map, p, title, None)
}

/// Like `render`, with a title page first when one is given and not empty.
/// The title page has no page number and does not count as page 1.
pub fn render_with_title(map: &PageMap, p: &Profile, title: &str, title_page: Option<&crate::title::TitlePage>) -> Result<Vec<u8>, String> {
    render_document(map, p, title_page, &PdfOptions { title: title.to_string(), ..Default::default() })
}

/// Everything about a PDF besides the pages themselves.
#[derive(Clone, Debug, Default)]
pub struct PdfOptions {
    pub title: String,
    pub author: String,
    /// e.g. the draft label; written as the PDF subject.
    pub subject: String,
    /// Seconds since 1970 (UTC) for the creation and modification dates.
    pub date_unix: i64,
    /// Stable id for this project's PDFs (32 characters are used).
    pub document_id: String,
    /// Printed top left from page 2 (already expanded, see `expand_tokens`).
    pub header: String,
    /// Printed centred at the bottom from page 2.
    pub footer: String,
}

/// Replace {title}, {draft} and {date} with the title page's values.
pub fn expand_tokens(text: &str, tp: &crate::title::TitlePage) -> String {
    text.replace("{title}", tp.title.lines().next().unwrap_or("").trim())
        .replace("{draft}", tp.draft_label.trim())
        .replace("{date}", tp.draft_date.trim())
}

fn id32(s: &str) -> String {
    // Exactly 32 printable characters: the trailer replacement must keep the length.
    let clean: String = s.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    let mut id = if clean.is_empty() { "kolbitar".to_string() } else { clean };
    while id.len() < 32 {
        id = format!("{id}{id}");
    }
    id[..32].to_string()
}

/// The PDF with a title page (if not empty), header and footer, and fixed metadata.
pub fn render_document(map: &PageMap, p: &Profile, title_page: Option<&crate::title::TitlePage>, opts: &PdfOptions) -> Result<Vec<u8>, String> {
    let date = printpdf::OffsetDateTime::from_unix_timestamp(opts.date_unix).map_err(|e| e.to_string())?;
    let doc_id = id32(&opts.document_id);
    let (doc, page1, layer1) = PdfDocument::new(opts.title.as_str(), mm(p.page_w_in), mm(p.page_h_in), "text");
    let doc = doc
        .with_author(opts.author.as_str())
        .with_subject(opts.subject.as_str())
        .with_creator("Kolbítar")
        .with_producer("Kolbítar")
        .with_document_id(doc_id.clone())
        .with_creation_date(date)
        .with_mod_date(date)
        .with_metadata_date(date);
    let load = |b: &[u8]| doc.add_external_font(Cursor::new(b.to_vec())).map_err(|e| e.to_string());
    let fonts: [IndirectFontRef; 4] = [load(REGULAR)?, load(BOLD)?, load(ITALIC)?, load(BOLD_ITALIC)?];
    let line_in = 1.0 / p.lines_per_inch;
    // Baseline sits about 0.8 of the line box below its top.
    let baseline = |row: usize| p.page_h_in - p.top_in - (row as f32) * line_in - 0.8 * line_in;
    let char_in = 1.0 / p.chars_per_inch;
    let mut first = Some((page1, layer1));
    let mut next_page = || first.take().unwrap_or_else(|| doc.add_page(mm(p.page_w_in), mm(p.page_h_in), "text"));
    if let Some(tp) = title_page.filter(|t| !t.is_empty()) {
        let (pi, li) = next_page();
        let layer = doc.get_page(pi).get_layer(li);
        for l in crate::title::layout(tp, p) {
            layer.use_text(l.text, p.font_pt, mm(l.x_in), mm(baseline(l.row)), &fonts[0]);
        }
    }
    for page in &map.pages {
        let (pi, li) = next_page();
        let layer = doc.get_page(pi).get_layer(li);
        if page.number > 1 {
            let label = format!("{}.", page.number);
            let x = p.page_w_in - 1.0 - label.chars().count() as f32 * char_in;
            let top = mm(p.page_h_in - 0.5 - 0.8 * line_in);
            layer.use_text(label, p.font_pt, mm(x), top, &fonts[0]);
            if !opts.header.trim().is_empty() {
                layer.use_text(opts.header.trim(), p.font_pt, mm(p.action.left_in), top, &fonts[0]);
            }
            if !opts.footer.trim().is_empty() {
                let w = unicode_width::UnicodeWidthStr::width(opts.footer.trim()) as f32 * char_in;
                let centre = (p.action.left_in + p.page_w_in - 1.0) / 2.0;
                layer.use_text(opts.footer.trim(), p.font_pt, mm(centre - w / 2.0), mm(0.5 - 0.2 * line_in), &fonts[0]);
            }
        }
        for l in &page.lines {
            let y = baseline(l.row);
            let mut x = l.x_in;
            for s in &l.segs {
                let f = &fonts[(s.bold as usize) | ((s.italic as usize) << 1)];
                let w = unicode_width::UnicodeWidthStr::width(s.text.as_str()) as f32 * char_in;
                if !s.text.is_empty() {
                    layer.use_text(s.text.clone(), p.font_pt, mm(x), mm(y), f);
                }
                if s.underline && w > 0.0 {
                    layer.set_outline_thickness(0.6);
                    layer.add_line(Line {
                        points: vec![(Point::new(mm(x), mm(y - 0.03)), false), (Point::new(mm(x + w), mm(y - 0.03)), false)],
                        is_closed: false,
                    });
                }
                x += w;
            }
        }
    }
    let mut out = BufWriter::new(Vec::new());
    doc.save(&mut out).map_err(|e| e.to_string())?;
    let mut bytes = out.into_inner().map_err(|e| e.to_string())?;
    // The trailer reads /ID[(<random>)(<random>)] (printpdf keeps its own
    // random ids there): write the fixed document id into both, same length,
    // so equal input gives equal bytes and no offset moves.
    if let Some(at) = find(&bytes, b"/ID[(").or_else(|| find(&bytes, b"/ID [(")) {
        let mut pos = at;
        for _ in 0..2 {
            let Some(open) = bytes[pos..].iter().position(|&b| b == b'(').map(|i| pos + i + 1) else { break };
            if bytes.len() >= open + 33 && bytes[open + 32] == b')' {
                bytes[open..open + 32].copy_from_slice(doc_id.as_bytes());
            }
            pos = open + 33;
        }
    }
    Ok(bytes)
}

fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).rposition(|w| w == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn render_fixture(opts: &PdfOptions) -> Vec<u8> {
        let doc = crate::fixtures::page_boundaries().to_document().unwrap();
        let p = Profile::us_letter();
        let map = crate::layout::paginate(&doc.blocks, &p, 1);
        render_document(&map, &p, Some(&crate::title::TitlePage { title: "SAME".into(), ..Default::default() }), opts).unwrap()
    }

    #[test]
    fn same_script_and_options_give_the_same_bytes() {
        let opts = PdfOptions { title: "Same".into(), author: "Jared Hoy".into(), date_unix: 1_790_000_000, document_id: "project-123".into(), header: "SAME - Blue".into(), footer: "Confidential".into(), ..Default::default() };
        let (a, b) = (render_fixture(&opts), render_fixture(&opts));
        assert_eq!(a.len(), b.len());
        if a != b {
            let diffs: Vec<usize> = (0..a.len()).filter(|&i| a[i] != b[i]).collect();
            let at = diffs[0];
            panic!("{} bytes differ, first at {at}: {:?} vs {:?}", diffs.len(), String::from_utf8_lossy(&a[at.saturating_sub(80)..(at + 60).min(a.len())]), String::from_utf8_lossy(&b[at.saturating_sub(80)..(at + 60).min(b.len())]));
        }
        let other_date = render_fixture(&PdfOptions { date_unix: 1_790_000_001, ..opts.clone() });
        assert!(other_date != a, "the date is part of the file");
        let text = String::from_utf8_lossy(&a);
        assert!(text.contains("Jared Hoy") && text.contains("Kol"), "metadata written");
    }

    #[test]
    fn tokens_expand_from_the_title_page() {
        let tp = crate::title::TitlePage { title: "THE TIDE LEDGER
Part 2".into(), draft_label: "Blue Revision".into(), draft_date: "1 May 2026".into(), ..Default::default() };
        assert_eq!(expand_tokens("{title} - {draft} - {date}", &tp), "THE TIDE LEDGER - Blue Revision - 1 May 2026");
    }
}
