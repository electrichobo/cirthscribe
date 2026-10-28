//! RTF export: plain RTF 1.x that Word, LibreOffice, TextEdit and WordPad
//! open. One named style per screenplay element; each paragraph also
//! carries its formatting directly, since many readers ignore style
//! definitions. Text outside ASCII is written as \uN escapes (UTF-16, so
//! characters beyond the Basic Multilingual Plane become two escapes).
//!
//! Like the DOCX export, a title page is its own section without header,
//! and the script section numbers pages from 1 with no number on page 1.

use crate::layout::Profile;
use crate::model::{Block, BlockKind};
use crate::numbering::Numbers;
use crate::printdoc::{self, DocExported, DocOptions, Para, TitleAlign};
use crate::title::TitlePage;

fn tw(inches: f32) -> i64 {
    (inches * 1440.0).round() as i64
}

/// RTF text: escapes, \line for line breaks, \tab for tabs, \uN for non-ASCII.
fn esc(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '\\' => o.push_str("\\\\"),
            '{' => o.push_str("\\{"),
            '}' => o.push_str("\\}"),
            '\n' => o.push_str("\\line "),
            '\t' => o.push_str("\\tab "),
            c if (c as u32) < 0x20 => {}
            c if c.is_ascii() => o.push(c),
            c => {
                let mut buf = [0u16; 2];
                for unit in c.encode_utf16(&mut buf) {
                    o.push_str(&format!("\\u{}?", *unit as i16));
                }
            }
        }
    }
    o
}

fn style_index(kind: BlockKind) -> usize {
    BlockKind::ALL.iter().position(|k| *k == kind).unwrap() + 1
}

/// Paragraph formatting of a block kind (used in the stylesheet and on each paragraph).
fn pfmt(p: &Profile, kind: BlockKind) -> String {
    let g = printdoc::geom(p, kind);
    let mut f = format!("\\s{}\\li{}\\ri{}\\sb{}\\sl-240\\slmult0", style_index(kind), tw(g.left_in), tw(g.right_in), g.space_before * 240);
    if g.keep_with_next {
        f.push_str("\\keepn");
    }
    if g.right_aligned {
        f.push_str("\\qr");
    }
    f
}

fn cfmt(p: &Profile, kind: BlockKind) -> &'static str {
    if printdoc::geom(p, kind).italic { "\\f0\\fs24\\i" } else { "\\f0\\fs24" }
}

fn para_rtf(p: &Profile, para: &Para) -> String {
    let mut s = format!("\\pard\\plain {}", pfmt(p, para.kind));
    if para.break_before {
        s.push_str("\\pagebb");
    }
    if para.number.is_some() {
        s.push_str("\\fi-1080\\tx0");
    }
    s.push(' ');
    s.push_str(cfmt(p, para.kind));
    s.push(' ');
    if let Some(n) = &para.number {
        s.push_str(&esc(n));
        s.push_str("\\tab ");
    }
    for r in &para.runs {
        let mut on = String::new();
        if r.bold {
            on.push_str("\\b");
        }
        if r.italic {
            on.push_str("\\i");
        }
        if r.underline {
            on.push_str("\\ul");
        }
        if on.is_empty() {
            s.push_str(&esc(&r.text));
        } else {
            s.push_str(&format!("{{{on} {}}}", esc(&r.text)));
        }
    }
    s.push_str("\\par\n");
    s
}

pub fn export(blocks: &[Block], p: &Profile, numbers: &Numbers, title_page: Option<&TitlePage>, opts: &DocOptions) -> DocExported {
    let (paras, counts) = printdoc::paras(blocks, p, numbers);
    let mut s = String::from("{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1\n{\\fonttbl{\\f0\\fmodern\\fcharset0 Courier Prime;}}\n{\\stylesheet{\\s0\\sl-240\\slmult0\\f0\\fs24 Normal;}");
    for kind in BlockKind::ALL {
        s.push_str(&format!("{{{}{} {};}}", pfmt(p, kind), cfmt(p, kind), printdoc::style_name(kind)));
    }
    s.push_str("}\n");
    s.push_str(&format!("{{\\info{{\\title {}}}{{\\author {}}}}}\n", esc(&opts.title), esc(&opts.author)));
    s.push_str(&format!(
        "\\paperw{}\\paperh{}\\margl{}\\margr{}\\margt{}\\margb{}\\deftab720\\widowctrl\n",
        tw(p.page_w_in),
        tw(p.page_h_in),
        tw(p.action.left_in),
        tw(1.0),
        tw(p.top_in),
        tw(p.bottom_in)
    ));
    let script_section = format!(
        "\\sectd\\sbkpage\\pgnrestart\\pgnstarts1\\titlepg\\headery720\\footery720\n{{\\headerr\\pard\\plain\\tqr\\tx{}\\f0\\fs24 {}\\tab\\chpgn .\\par}}\n{{\\footerr\\pard\\plain\\qc\\f0\\fs24 {}\\par}}\n",
        tw(printdoc::column_in(p)),
        esc(opts.header.trim()),
        esc(opts.footer.trim())
    );
    if let Some(tp) = title_page.filter(|t| !t.is_empty()) {
        s.push_str("\\sectd\\sbknone\n");
        for t in printdoc::title_paras(tp, p) {
            let q = match t.align {
                TitleAlign::Centre => "\\qc",
                TitleAlign::Left => "\\ql",
                TitleAlign::Right => "\\qr",
            };
            s.push_str(&format!("\\pard\\plain\\sb{}\\sl-240\\slmult0{q}\\f0\\fs24 {}\\par\n", t.space_before * 240, esc(&t.text)));
        }
        s.push_str("\\sect\n");
    }
    s.push_str(&script_section);
    for para in &paras {
        s.push_str(&para_rtf(p, para));
    }
    s.push('}');
    let mut notes = printdoc::notes(&counts, "RTF");
    notes.push("Not yet checked in Word, LibreOffice or TextEdit themselves.".into());
    DocExported { bytes: s.into_bytes(), notes }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Run;

    #[test]
    fn escapes_braces_backslashes_and_unicode_and_balances_groups() {
        assert_eq!(esc("a{b}c\\d"), "a\\{b\\}c\\\\d");
        assert_eq!(esc("café"), "caf\\u233?");
        assert_eq!(esc("😀"), "\\u-10179?\\u-8704?", "two UTF-16 escapes beyond the BMP");
        let mut a = Block::new(BlockKind::Action, "");
        a.runs = vec![Run::plain("Plain {braces} "), Run { italic: true, ..Run::plain("é") }];
        let blocks = vec![Block::new(BlockKind::Heading, "int. lab - night"), a, Block::new(BlockKind::Character, "Mara"), Block::new(BlockKind::Dialogue, "Hi.")];
        let tp = TitlePage { title: "TIDE".into(), contact: "a@example.invalid".into(), ..Default::default() };
        let out = export(&blocks, &Profile::us_letter(), &Numbers::new(), Some(&tp), &DocOptions { header: "TIDE".into(), ..Default::default() });
        let s = String::from_utf8(out.bytes).unwrap();
        assert!(s.is_ascii());
        // Groups balance once escaped braces are ignored.
        let depth = s.replace("\\\\", "").replace("\\{", "").replace("\\}", "").chars().fold(0i32, |d, c| match c {
            '{' => d + 1,
            '}' => d - 1,
            _ => d,
        });
        assert_eq!(depth, 0);
        assert!(s.starts_with("{\\rtf1") && s.contains("INT. LAB - NIGHT") && s.contains("{\\i \\u233?}"));
        assert!(s.contains("\\paperw12240\\paperh15840\\margl2160"), "US Letter, 1.5 in left margin");
        assert!(s.contains("\\li1440\\ri2160"), "dialogue indents");
        assert!(s.contains("\\sect\n") && s.contains("\\pgnrestart"), "title page section, then numbering from 1");
    }
}
