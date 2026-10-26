//! PDF proof of concept. Draws exactly the lines in a `PageMap`; it does no
//! line breaking of its own. Fonts are embedded so text stays selectable.

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
    let (doc, page1, layer1) = PdfDocument::new(title, mm(p.page_w_in), mm(p.page_h_in), "text");
    let load = |b: &[u8]| doc.add_external_font(Cursor::new(b.to_vec())).map_err(|e| e.to_string());
    let fonts: [IndirectFontRef; 4] = [load(REGULAR)?, load(BOLD)?, load(ITALIC)?, load(BOLD_ITALIC)?];
    let line_in = 1.0 / p.lines_per_inch;
    // Baseline sits about 0.8 of the line box below its top.
    let baseline = |row: usize| p.page_h_in - p.top_in - (row as f32) * line_in - 0.8 * line_in;
    let char_in = 1.0 / p.chars_per_inch;
    for (i, page) in map.pages.iter().enumerate() {
        let (pi, li) = if i == 0 { (page1, layer1) } else { doc.add_page(mm(p.page_w_in), mm(p.page_h_in), "text") };
        let layer = doc.get_page(pi).get_layer(li);
        if page.number > 1 {
            let label = format!("{}.", page.number);
            let x = p.page_w_in - 1.0 - label.chars().count() as f32 * char_in;
            layer.use_text(label, p.font_pt, mm(x), mm(p.page_h_in - 0.5 - 0.8 * line_in), &fonts[0]);
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
    out.into_inner().map_err(|e| e.to_string())
}
