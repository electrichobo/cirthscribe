//! PDF output. Draws exactly the lines in a `PageMap`; it does no line
//! breaking of its own. Fonts are embedded so text stays selectable.
//!
//! The same script and options always give the same bytes: the date and
//! document id come from `PdfOptions`, and the random "instance id" that
//! printpdf writes into the trailer is replaced by the document id (same
//! length, so no offsets move). Header and footer lines, like page numbers,
//! start on page 2.
//!
//! Hebrew, Arabic and Devanagari, which Courier Prime cannot draw, print in a
//! bundled Noto font: the line is put in visual order (unicode-bidi), each run
//! is shaped (rustybuzz) and squeezed into the columns the fixed-pitch layout
//! gave it, so page breaks stay as paginated. A fallback font is embedded only
//! when a document uses it; lines Courier Prime can draw print as before.
//! Chinese, Japanese and Korean are not printed yet (screen only).

use crate::fontcheck::{self, FontInfo};
use crate::layout::{PageMap, Profile, Seg};
use printpdf::{IndirectFontRef, Line, Mm, PdfDocument, PdfDocumentReference, PdfLayerReference, Point, TextMatrix};
use std::io::{BufWriter, Cursor};
use unicode_bidi::{BidiInfo, Level};
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

pub static REGULAR: &[u8] = include_bytes!("../../../assets/fonts/courier-prime/CourierPrime-Regular.ttf");
pub static BOLD: &[u8] = include_bytes!("../../../assets/fonts/courier-prime/CourierPrime-Bold.ttf");
pub static ITALIC: &[u8] = include_bytes!("../../../assets/fonts/courier-prime/CourierPrime-Italic.ttf");
pub static BOLD_ITALIC: &[u8] = include_bytes!("../../../assets/fonts/courier-prime/CourierPrime-BoldItalic.ttf");

/// Fallback fonts for scripts Courier Prime lacks, tried in this order (regular weight only).
pub static FALLBACKS: [&[u8]; 3] = [
    include_bytes!("../../../assets/fonts/noto-sans-hebrew/NotoSansHebrew-Regular.ttf"),
    include_bytes!("../../../assets/fonts/noto-sans-arabic/NotoSansArabic-Regular.ttf"),
    include_bytes!("../../../assets/fonts/noto-sans-devanagari/NotoSansDevanagari-Regular.ttf"),
];

/// Characters in `text` that no font a PDF can use (Courier Prime or a fallback) can draw.
pub fn missing_chars(text: &str) -> Vec<char> {
    let Some(courier) = FontInfo::parse(REGULAR) else { return Vec::new() };
    let fallbacks: Vec<FontInfo> = FALLBACKS.iter().filter_map(|b| FontInfo::parse(b)).collect();
    let mut out = fontcheck::missing_chars(&courier, text);
    out.retain(|c| !fallbacks.iter().any(|f| f.glyph(*c) != 0));
    out
}

/// Fonts for one document: the four Courier Prime faces, plus fallbacks loaded on first use.
struct Fonts<'a> {
    doc: &'a PdfDocumentReference,
    courier: [IndirectFontRef; 4],
    courier_info: FontInfo<'static>,
    fallback_info: Vec<FontInfo<'static>>,
    fallback: [Option<IndirectFontRef>; 3],
}

impl Fonts<'_> {
    /// 0 for Courier Prime (or when nothing can draw `c`), else 1 + the fallback's index.
    fn pick(&self, c: char) -> usize {
        if c.is_whitespace() || self.courier_info.glyph(c) != 0 {
            return 0;
        }
        self.fallback_info.iter().position(|f| f.glyph(c) != 0).map_or(0, |i| i + 1)
    }

    fn fallback(&mut self, i: usize) -> Result<IndirectFontRef, String> {
        if self.fallback[i].is_none() {
            let f = self.doc.add_external_font(Cursor::new(FALLBACKS[i].to_vec())).map_err(|e| e.to_string())?;
            self.fallback[i] = Some(f);
        }
        Ok(self.fallback[i].clone().expect("loaded above"))
    }
}

/// Blocks whose text runs right to left: the first strong character of the
/// block decides, so every wrapped line keeps its paragraph's direction.
fn rtl_blocks(map: &PageMap) -> std::collections::HashSet<String> {
    let (mut seen, mut rtl) = (std::collections::HashSet::new(), std::collections::HashSet::new());
    for l in map.pages.iter().flat_map(|pg| &pg.lines) {
        let Some(id) = &l.block_id else { continue };
        if seen.contains(id) {
            continue;
        }
        let text: String = l.segs.iter().map(|s| s.text.as_str()).collect();
        match unicode_bidi::get_base_direction(text.as_str()) {
            unicode_bidi::Direction::Rtl => {
                rtl.insert(id.clone());
                seen.insert(id.clone());
            }
            unicode_bidi::Direction::Ltr => {
                seen.insert(id.clone());
            }
            unicode_bidi::Direction::Mixed => {}
        }
    }
    rtl
}

/// How shaped text fills the columns the layout gave it: text that is too
/// wide is squeezed to fit; text that is narrower (joined Arabic letters,
/// Devanagari conjuncts) widens a little, at most `MAX_WIDEN`, and what room
/// is left is shared on both sides, so no wide gap opens beside the word.
/// Returns the horizontal scale and the space before the text, in points.
const MAX_WIDEN: f32 = 1.12;
fn fit(natural: f32, room: f32) -> (f32, f32) {
    if natural <= 0.0 || room <= 0.0 {
        return (1.0, 0.0);
    }
    let scale = (room / natural).min(MAX_WIDEN);
    (scale, ((room - natural * scale) / 2.0).max(0.0))
}

/// Draws one line that needs a fallback font, starting at `x_in`. Every piece
/// takes exactly its column width, as in the layout, so the line ends where the
/// page map says it does.
#[allow(clippy::too_many_arguments)]
fn draw_mixed_line(layer: &PdfLayerReference, fonts: &mut Fonts, segs: &[Seg], rtl_para: bool, x_in: f32, y_in: f32, font_pt: f32, char_in: f32) -> Result<(), String> {
    let mut text = String::new();
    let mut seg_at = Vec::new(); // the seg index of each byte of `text`
    for (i, s) in segs.iter().enumerate() {
        text.push_str(&s.text);
        seg_at.resize(text.len(), i);
    }
    let bidi = BidiInfo::new(&text, Some(if rtl_para { Level::rtl() } else { Level::ltr() }));
    let Some(para) = bidi.paragraphs.first() else { return Ok(()) };
    let (levels, runs) = bidi.visual_runs(para, para.range.clone());
    let mut x = x_in;
    for run in runs {
        let rtl = levels[run.start].is_rtl();
        // Split the run where the style or the font changes (logical order).
        let mut pieces: Vec<(usize, usize, usize)> = Vec::new(); // (start, end, font)
        for (off, c) in text[run.clone()].char_indices() {
            let at = run.start + off;
            let font = fonts.pick(c);
            match pieces.last_mut() {
                // A combining mark stays in its base character's piece.
                Some(last) if seg_at[last.0] == seg_at[at] && (last.2 == font || c.width() == Some(0)) => last.1 = at + c.len_utf8(),
                _ => pieces.push((at, at + c.len_utf8(), font)),
            }
        }
        if rtl {
            pieces.reverse();
        }
        for (start, end, font) in pieces {
            let piece = &text[start..end];
            let seg = &segs[seg_at[start]];
            let w = piece.width() as f32 * char_in;
            if font == 0 {
                let shown: String = if rtl { piece.chars().rev().collect() } else { piece.to_string() };
                let f = &fonts.courier[(seg.bold as usize) | ((seg.italic as usize) << 1)];
                layer.use_text(shown, font_pt, mm(x), mm(y_in), f);
            } else {
                let face = rustybuzz::Face::from_slice(FALLBACKS[font - 1], 0).ok_or("fallback font unreadable")?;
                let mut buf = rustybuzz::UnicodeBuffer::new();
                buf.push_str(piece);
                buf.set_direction(if rtl { rustybuzz::Direction::RightToLeft } else { rustybuzz::Direction::LeftToRight });
                buf.guess_segment_properties();
                let shaped = rustybuzz::shape(&face, &[], buf);
                let k = font_pt / face.units_per_em() as f32; // font units to points
                let natural: f32 = shaped.glyph_positions().iter().map(|g| g.x_advance as f32 * k).sum();
                let (squeeze, lead) = fit(natural, w * 72.0);
                let f = fonts.fallback(font - 1)?;
                let (x0, y0) = (x * 72.0 + lead, y_in * 72.0);
                let mut pen = 0.0;
                for (info, pos) in shaped.glyph_infos().iter().zip(shaped.glyph_positions()) {
                    let gx = x0 + (pen + pos.x_offset as f32 * k) * squeeze;
                    let gy = y0 + pos.y_offset as f32 * k;
                    layer.begin_text_section();
                    layer.set_font(&f, font_pt);
                    layer.set_text_matrix(TextMatrix::Raw([squeeze, 0.0, 0.0, 1.0, gx, gy]));
                    layer.write_codepoints([info.glyph_id as u16]);
                    layer.end_text_section();
                    pen += pos.x_advance as f32 * k;
                }
            }
            if seg.underline && w > 0.0 {
                layer.set_outline_thickness(0.6);
                layer.add_line(Line { points: vec![(Point::new(mm(x), mm(y_in - 0.03)), false), (Point::new(mm(x + w), mm(y_in - 0.03)), false)], is_closed: false });
            }
            x += w;
        }
    }
    Ok(())
}

pub(crate) fn mm(inches: f32) -> Mm {
    Mm(inches * 25.4)
}

pub(crate) fn page_mm(inches: f32) -> Mm {
    let target = (inches * 72.0 * 100.0).round() / 100.0;
    let mut m = target / 2.834_646_f32;
    for _ in 0..64 {
        let got = m * 2.834_646_f32;
        if got == target {
            break;
        }
        m = f32::from_bits(if got > target { m.to_bits() - 1 } else { m.to_bits() + 1 });
    }
    Mm(m)
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
    /// Printed before the page number on pages flagged `revised`.
    pub revision_header: String,
}

/// Replace {title}, {draft} and {date} with the title page's values.
pub fn expand_tokens(text: &str, tp: &crate::title::TitlePage) -> String {
    text.replace("{title}", tp.title.lines().next().unwrap_or("").trim())
        .replace("{draft}", tp.draft_label.trim())
        .replace("{date}", tp.draft_date.trim())
}

pub(crate) fn id32(s: &str) -> String {
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
    let (doc, page1, layer1) = PdfDocument::new(opts.title.as_str(), page_mm(p.page_w_in), page_mm(p.page_h_in), "text");
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
    let mut mixed = Fonts {
        doc: &doc,
        courier: fonts.clone(),
        courier_info: FontInfo::parse(REGULAR).ok_or("bundled font unreadable")?,
        fallback_info: FALLBACKS.iter().filter_map(|b| FontInfo::parse(b)).collect(),
        fallback: [None, None, None],
    };
    let rtl = rtl_blocks(map);
    let line_in = 1.0 / p.lines_per_inch;
    // Baseline sits about 0.8 of the line box below its top.
    let baseline = |row: usize| p.page_h_in - p.top_in - (row as f32) * line_in - 0.8 * line_in;
    let char_in = 1.0 / p.chars_per_inch;
    let mut first = Some((page1, layer1));
    let mut next_page = || first.take().unwrap_or_else(|| doc.add_page(page_mm(p.page_w_in), page_mm(p.page_h_in), "text"));
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
        let top = mm(p.page_h_in - 0.5 - 0.8 * line_in);
        let rev = opts.revision_header.trim();
        if page.revised && !rev.is_empty() {
            // Ends four characters before the page number (or at its place on page 1).
            let number_w = if page.number > 1 { (format!("{}.", page.label).chars().count() + 4) as f32 * char_in } else { 0.0 };
            let w = unicode_width::UnicodeWidthStr::width(rev) as f32 * char_in;
            layer.use_text(rev, p.font_pt, mm(p.page_w_in - 1.0 - number_w - w), top, &fonts[0]);
        }
        if page.number > 1 {
            let label = format!("{}.", page.label);
            let x = p.page_w_in - 1.0 - label.chars().count() as f32 * char_in;
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
            if l.segs.iter().any(|s| s.text.chars().any(|c| mixed.pick(c) != 0)) {
                let rtl_para = l.block_id.as_ref().is_some_and(|id| rtl.contains(id));
                draw_mixed_line(&layer, &mut mixed, &l.segs, rtl_para, l.x_in, y, p.font_pt, char_in)?;
                continue;
            }
            let mut x = l.x_in;
            for s in &l.segs {
                let f = &fonts[(s.bold as usize) | ((s.italic as usize) << 1)];
                let w = s.text.width() as f32 * char_in;
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
    fix_trailer_id(&mut bytes, &doc_id);
    fix_to_unicode(&mut bytes);
    Ok(fix_info_strings(bytes))
}

/// printpdf writes each font's ToUnicode map with characters beyond U+FFFF as
/// five or six hex digits (`<10efd>`), which is not a valid UTF-16 string and
/// stops other programs reading the text back. Those characters are only ever
/// glyphs the font has and the script does not use, so each becomes U+FFFD,
/// padded with spaces to the same length: no offset in the file moves.
pub(crate) fn fix_to_unicode(bytes: &mut [u8]) {
    let mut at = 0;
    while let Some(start) = find_from(bytes, at, b"begincmap") {
        let Some(end) = find_from(bytes, start, b"endcmap") else { return };
        let mut i = start;
        while i < end {
            if bytes[i] == b'<' && bytes.get(i + 1) != Some(&b'<') {
                let mut j = i + 1;
                while j < end && bytes[j].is_ascii_hexdigit() {
                    j += 1;
                }
                let n = j - i - 1;
                if j < end && bytes[j] == b'>' && (n == 5 || n == 6) {
                    bytes[i + 1..i + 5].copy_from_slice(b"fffd");
                    for b in &mut bytes[i + 5..j] {
                        *b = b' ';
                    }
                }
                i = j;
            } else {
                i += 1;
            }
        }
        at = end;
    }
}

pub(crate) fn fix_trailer_id(bytes: &mut [u8], doc_id: &str) {
    let id = id32(doc_id);
    if let Some(at) = find(bytes, b"/ID[(").or_else(|| find(bytes, b"/ID [(")) {
        let mut pos = at;
        for _ in 0..2 {
            let Some(open) = bytes[pos..].iter().position(|&b| b == b'(').map(|i| pos + i + 1) else { break };
            if bytes.len() >= open + 33 && bytes[open + 32] == b')' {
                bytes[open..open + 32].copy_from_slice(id.as_bytes());
            }
            pos = open + 33;
        }
    }
}

fn find(hay: &[u8], needle: &[u8]) -> Option<usize> {
    hay.windows(needle.len()).rposition(|w| w == needle)
}

fn find_from(hay: &[u8], from: usize, needle: &[u8]) -> Option<usize> {
    hay.get(from..)?.windows(needle.len()).position(|w| w == needle).map(|i| from + i)
}

fn number_after(hay: &[u8], at: usize) -> Option<(usize, usize)> {
    let start = at + hay[at..].iter().position(|b| b.is_ascii_digit())?;
    let end = start + hay[start..].iter().position(|b| !b.is_ascii_digit()).unwrap_or(hay.len() - start);
    Some((std::str::from_utf8(&hay[start..end]).ok()?.parse().ok()?, end))
}

/// printpdf writes Info strings (Title, Author, Creator …) as raw UTF-8,
/// which viewers read as PDFDocEncoding ("KolbÃ­tar"). Rewrite any string in
/// the Info dictionary that is not plain ASCII as UTF-16BE with a BOM, the
/// form the PDF spec gives for text strings, and shift the cross-reference
/// offsets after it. Only the layout printpdf/lopdf writes is handled (one
/// uncompressed cross-reference stream with 4-byte offsets); anything else
/// is returned unchanged.
pub(crate) fn fix_info_strings(bytes: Vec<u8>) -> Vec<u8> {
    let attempt = || -> Option<Vec<u8>> {
        let sx = find(&bytes, b"startxref")?;
        let (xref_at, _) = number_after(&bytes, sx + 9)?;
        let dict_end = find_from(&bytes, xref_at, b"stream")?;
        let dict = &bytes[xref_at..dict_end];
        let has = |needle: &[u8]| find_from(dict, 0, needle).is_some();
        if !has(b"/Type/XRef") || has(b"/Filter") || !has(b"/W[1 4 2]") {
            return None;
        }
        let info_at = find_from(dict, 0, b"/Info")?;
        let (info_obj, _) = number_after(dict, info_at + 5)?;
        let (_first_object, after) = number_after(dict, find_from(dict, 0, b"/Index[")? + 7)?;
        let (index_count, _) = number_after(dict, after)?;
        let (length, _) = number_after(dict, find_from(dict, 0, b"/Length")? + 7)?;
        // The Info object and its strings.
        let head = format!("\n{info_obj} 0 obj");
        let obj_start = find_from(&bytes, 0, head.as_bytes())? + 1;
        let obj_end = find_from(&bytes, obj_start, b"endobj")?;
        if obj_end > xref_at {
            return None;
        }
        let mut new_obj = Vec::new();
        let obj = &bytes[obj_start..obj_end];
        let mut i = 0;
        while i < obj.len() {
            if obj[i] != b'(' {
                new_obj.push(obj[i]);
                i += 1;
                continue;
            }
            // A literal string: unescape, then keep it or rewrite it.
            let (mut depth, mut j, mut raw) = (1, i + 1, Vec::new());
            while j < obj.len() && depth > 0 {
                match obj[j] {
                    b'\\' if j + 1 < obj.len() => {
                        raw.push(match obj[j + 1] {
                            b'n' => b'\n',
                            b'r' => b'\r',
                            b't' => b'\t',
                            c => c,
                        });
                        j += 2;
                        continue;
                    }
                    b'(' => depth += 1,
                    b')' => depth -= 1,
                    _ => {}
                }
                if depth > 0 {
                    raw.push(obj[j]);
                }
                j += 1;
            }
            if raw.is_ascii() {
                new_obj.extend_from_slice(&obj[i..j]);
            } else {
                let text = String::from_utf8_lossy(&raw);
                new_obj.extend_from_slice(b"<FEFF");
                for unit in text.encode_utf16() {
                    new_obj.extend_from_slice(format!("{unit:04X}").as_bytes());
                }
                new_obj.push(b'>');
            }
            i = j;
        }
        let delta = new_obj.len() as i64 - obj.len() as i64;
        if delta == 0 {
            return None;
        }
        // Shift every object that starts after the Info object.
        let data_start = dict_end + 6 + if bytes.get(dict_end + 6) == Some(&b'\r') { 2 } else { 1 };
        if length != index_count * 7 || data_start + length > bytes.len() {
            return None;
        }
        let mut out = bytes.clone();
        for e in 0..index_count {
            let at = data_start + e * 7;
            if out[at] != 1 {
                continue;
            }
            let off = u32::from_be_bytes(out[at + 1..at + 5].try_into().ok()?) as i64;
            if off > obj_start as i64 {
                out[at + 1..at + 5].copy_from_slice(&u32::try_from(off + delta).ok()?.to_be_bytes());
            }
        }
        let mut fixed = Vec::with_capacity(out.len() + delta.max(0) as usize);
        fixed.extend_from_slice(&out[..obj_start]);
        fixed.extend_from_slice(&new_obj);
        fixed.extend_from_slice(&out[obj_end..sx]);
        fixed.extend_from_slice(format!("startxref\n{}\n%%EOF\n", xref_at as i64 + delta).as_bytes());
        Some(fixed)
    };
    attempt().unwrap_or(bytes)
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
        // ASCII stays a plain string; "Kolbítar" is UTF-16BE with a BOM (see fix_info_strings).
        assert!(text.contains("(Jared Hoy)"), "ASCII author as a plain string");
        assert!(text.contains("<FEFF004B006F006C006200ED007400610072>"), "Kolbítar as UTF-16BE");
    }

    /// Check a cross-reference stream: every in-use entry and `startxref`
    /// point at the start of the right object.
    fn assert_xref_valid(bytes: &[u8]) {
        let sx = find(bytes, b"startxref").unwrap();
        let (xref_at, _) = number_after(bytes, sx + 9).unwrap();
        let (xref_obj, _) = number_after(bytes, xref_at).unwrap();
        assert!(bytes[xref_at..].starts_with(format!("{xref_obj} 0 obj").as_bytes()), "startxref points at the xref object");
        let dict_end = find_from(bytes, xref_at, b"stream").unwrap();
        let dict = &bytes[xref_at..dict_end];
        let (first, after) = number_after(dict, find_from(dict, 0, b"/Index[").unwrap() + 7).unwrap();
        let (count, _) = number_after(dict, after).unwrap();
        let data = dict_end + 7;
        for e in 0..count {
            let at = data + e * 7;
            if bytes[at] == 1 {
                let off = u32::from_be_bytes(bytes[at + 1..at + 5].try_into().unwrap()) as usize;
                assert!(bytes[off..].starts_with(format!("{} 0 obj", first + e).as_bytes()), "object {} at {off}", first + e);
            }
        }
    }

    #[test]
    fn info_strings_are_utf16_and_offsets_still_point_at_their_objects() {
        let p = Profile::us_letter();
        let doc = crate::fixtures::page_boundaries().to_document().unwrap();
        let map = crate::layout::paginate(&doc.blocks, &p, 1);
        let opts = PdfOptions { title: "Café Nørdlys".into(), author: "Zoë Writer".into(), date_unix: 1_767_225_600, document_id: "info-test".into(), ..Default::default() };
        let bytes = render_document(&map, &p, None, &opts).unwrap();
        assert_xref_valid(&bytes);
        let utf16 = |s: &str| format!("<FEFF{}>", s.encode_utf16().map(|u| format!("{u:04X}")).collect::<String>());
        let text = String::from_utf8_lossy(&bytes);
        for s in ["Kolbítar", "Café Nørdlys", "Zoë Writer"] {
            assert!(text.contains(&utf16(s)), "{s} as UTF-16BE with BOM");
        }
        assert!(!text.contains("Kolbítar)"), "no raw UTF-8 Info string left");
        assert!(text.contains("/MediaBox[0 0 612 792]"), "whole points for US Letter");
        assert_eq!(bytes, render_document(&map, &p, None, &opts).unwrap(), "still repeatable");
    }

    #[test]
    fn tokens_expand_from_the_title_page() {
        let tp = crate::title::TitlePage { title: "THE TIDE LEDGER
Part 2".into(), draft_label: "Blue Revision".into(), draft_date: "1 May 2026".into(), ..Default::default() };
        assert_eq!(expand_tokens("{title} - {draft} - {date}", &tp), "THE TIDE LEDGER - Blue Revision - 1 May 2026");
    }

    #[test]
    fn to_unicode_maps_have_only_valid_utf16() {
        let mut b = b"x begincmap\n2 beginbfchar\n<01dc> <10efd>\n<0003> <0020>\n<0004> <10ffff>\nendbfchar\nendcmap <10efd>".to_vec();
        let n = b.len();
        fix_to_unicode(&mut b);
        assert_eq!(b.len(), n, "nothing moves");
        assert_eq!(String::from_utf8(b).unwrap(), "x begincmap\n2 beginbfchar\n<01dc> <fffd >\n<0003> <0020>\n<0004> <fffd  >\nendbfchar\nendcmap <10efd>");
        // Our PDFs with Arabic and Devanagari now read back (the CMap parser used to stop at them).
        let opts = PdfOptions { title: "Scripts".into(), date_unix: 1_790_000_000, document_id: "scripts".into(), ..Default::default() };
        let p = Profile::us_letter();
        let doc = crate::fixtures::unicode_marks().to_document().unwrap();
        let map = crate::layout::paginate(&doc.blocks, &p, 1);
        let bytes = render_document(&map, &p, None, &opts).unwrap();
        assert_xref_valid(&bytes);
        let s = String::from_utf8_lossy(&bytes);
        assert!(!regex_like_odd_hex(&s), "no odd-length hex left in a ToUnicode map");
    }

    fn regex_like_odd_hex(s: &str) -> bool {
        let mut rest = s;
        while let Some(a) = rest.find("begincmap") {
            let Some(e) = rest[a..].find("endcmap") else { break };
            let body = &rest[a..a + e];
            for tok in body.split('<').skip(1) {
                if let Some(end) = tok.find('>') {
                    let h = &tok[..end];
                    if !h.is_empty() && h.chars().all(|c| c.is_ascii_hexdigit()) && h.len() % 2 == 1 {
                        return true;
                    }
                }
            }
            rest = &rest[a + e..];
        }
        false
    }

    #[test]
    fn narrow_shaped_text_widens_a_little_and_is_centred_in_its_columns() {
        // Too wide: squeezed to exactly its room, no space before it.
        assert_eq!(fit(50.0, 36.0), (36.0 / 50.0, 0.0));
        // A little narrow: widened to fill its room.
        let (s, lead) = fit(34.0, 36.0);
        assert!((s * 34.0 - 36.0).abs() < 1e-4 && lead.abs() < 1e-4);
        // Much narrower (an Arabic word in its columns): widened at most 12%, the rest shared on both sides.
        let (s, lead) = fit(24.0, 36.0);
        assert!((s - MAX_WIDEN).abs() < 1e-6);
        assert!((lead * 2.0 + 24.0 * s - 36.0).abs() < 1e-4, "it still ends where its columns end");
        assert!(lead > 0.0 && lead < 36.0 * 0.2, "the gap on each side stays small: {lead}");
        assert_eq!(fit(0.0, 36.0), (1.0, 0.0));
    }

    #[test]
    fn hebrew_arabic_and_devanagari_print_from_fallback_fonts_and_cjk_is_reported() {
        assert!(missing_chars("שלום مرحبا नमस्ते").is_empty(), "Hebrew, Arabic and Devanagari have a PDF font");
        assert_eq!(missing_chars("日本 é"), vec!['日', '本'], "CJK is still reported; Latin accents are in Courier Prime");

        let opts = PdfOptions { title: "Scripts".into(), date_unix: 1_790_000_000, document_id: "scripts".into(), ..Default::default() };
        let p = Profile::us_letter();
        let doc = crate::fixtures::unicode_marks().to_document().unwrap();
        let map = crate::layout::paginate(&doc.blocks, &p, 1);
        let bytes = render_document(&map, &p, None, &opts).unwrap();
        assert_xref_valid(&bytes);
        // Fonts are named F0, F1, ...: four Courier Prime faces, then each fallback on first use.
        let fonts = |b: &[u8]| (0..8).filter(|i| String::from_utf8_lossy(b).contains(&format!("/BaseFont/F{i}"))).count();
        assert_eq!(fonts(&bytes), 6, "Hebrew and Arabic are embedded; Devanagari, unused, is not");
        assert_eq!(bytes, render_document(&map, &p, None, &opts).unwrap(), "still the same bytes every time");

        // A script Courier Prime can draw embeds no fallback at all.
        assert_eq!(fonts(&render_fixture(&opts)), 4, "Latin-only PDFs embed only Courier Prime");
    }
}
