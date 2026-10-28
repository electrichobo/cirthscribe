//! HTML export: one standalone, escaped page with its styles inline (no
//! scripts, fonts or links to fetch), readable in a browser and printable.
//! Each paragraph is a <p> with its element as class; scene numbers sit in
//! both margins; forced page breaks and the title page use CSS page breaks.
//! Browsers lay out their own print pages, and headers, footers and page
//! numbers are not part of HTML, so the report says so.

use crate::layout::Profile;
use crate::model::Block;
use crate::numbering::Numbers;
use crate::printdoc::{self, DocExported, DocOptions, Para, TitleAlign};
use crate::title::TitlePage;

fn esc(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for c in s.chars().filter(|c| printdoc::xml_safe(*c)) {
        match c {
            '&' => o.push_str("&amp;"),
            '<' => o.push_str("&lt;"),
            '>' => o.push_str("&gt;"),
            '"' => o.push_str("&quot;"),
            '\'' => o.push_str("&#39;"),
            '\n' => o.push_str("<br>"),
            _ => o.push(c),
        }
    }
    o
}

fn class(kind: crate::model::BlockKind) -> String {
    printdoc::style_name(kind).to_lowercase().replace(' ', "-")
}

fn css(p: &Profile) -> String {
    let size = if p.page_w_in < 8.4 { "A4" } else { "letter" };
    let mut s = format!(
        "@page {{ size: {size}; margin: {top}in 1in {bottom}in {left}in; }}\n\
body {{ margin: 0; background: #fff; color: #000; }}\n\
main, .title-page {{ max-width: {col}in; margin: 1in auto; padding-left: 0.8in; padding-right: 0.8in; font-family: \"Courier Prime\", \"Courier New\", Courier, monospace; font-size: 12pt; line-height: 12pt; }}\n\
@media print {{ main, .title-page {{ margin: 0; padding: 0; max-width: none; }} }}\n\
p {{ margin: 0; white-space: pre-wrap; position: relative; }}\n\
.title-page {{ break-after: page; }}\n\
.title-page p.centre {{ text-align: center; }} .title-page p.right {{ text-align: right; }}\n\
.page-break {{ break-before: page; }}\n\
.num {{ position: absolute; top: 0; }} .num.left {{ right: calc(100% + 0.3in); }} .num.right {{ left: calc({col}in + 0.3in); }}\n",
        top = p.top_in,
        bottom = p.bottom_in,
        left = p.action.left_in,
        col = printdoc::column_in(p),
    );
    for kind in crate::model::BlockKind::ALL {
        let g = printdoc::geom(p, kind);
        s.push_str(&format!(
            "p.{} {{ margin-left: {:.2}in; margin-right: {:.2}in; margin-top: {}pt;{}{}{} }}\n",
            class(kind),
            g.left_in,
            g.right_in,
            g.space_before * 12,
            if g.right_aligned { " text-align: right;" } else { "" },
            if g.italic { " font-style: italic;" } else { "" },
            if g.keep_with_next { " break-after: avoid;" } else { "" },
        ));
    }
    s
}

fn para_html(para: &Para) -> String {
    let mut cls = class(para.kind);
    if para.break_before {
        cls.push_str(" page-break");
    }
    let mut body = String::new();
    if let Some(n) = &para.number {
        // Both margins, as in the PDF; screen readers read the left one only.
        body.push_str(&format!("<span class=\"num left\">{0} </span><span class=\"num right\" aria-hidden=\"true\">{0}</span>", esc(n)));
    }
    for r in &para.runs {
        let mut t = esc(&r.text);
        if r.underline {
            t = format!("<u>{t}</u>");
        }
        if r.italic {
            t = format!("<em>{t}</em>");
        }
        if r.bold {
            t = format!("<strong>{t}</strong>");
        }
        body.push_str(&t);
    }
    format!("<p class=\"{cls}\">{body}</p>\n")
}

pub fn export(blocks: &[Block], p: &Profile, numbers: &Numbers, title_page: Option<&TitlePage>, opts: &DocOptions) -> DocExported {
    let (paras, counts) = printdoc::paras(blocks, p, numbers);
    let title = if opts.title.trim().is_empty() { "Screenplay".to_string() } else { opts.title.trim().to_string() };
    let mut s = format!(
        "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<meta name=\"generator\" content=\"Kolbítar\">\n{}<title>{}</title>\n<style>\n{}</style>\n</head>\n<body>\n",
        if opts.author.trim().is_empty() { String::new() } else { format!("<meta name=\"author\" content=\"{}\">\n", esc(opts.author.trim())) },
        esc(&title),
        css(p)
    );
    if let Some(tp) = title_page.filter(|t| !t.is_empty()) {
        s.push_str("<section class=\"title-page\" aria-label=\"Title page\">\n");
        for t in printdoc::title_paras(tp, p) {
            let cls = match t.align {
                TitleAlign::Centre => "centre",
                TitleAlign::Left => "left",
                TitleAlign::Right => "right",
            };
            s.push_str(&format!("<p class=\"{cls}\" style=\"margin-top: {}pt\">{}</p>\n", t.space_before * 12, esc(&t.text)));
        }
        s.push_str("</section>\n");
    }
    s.push_str("<main>\n");
    for para in &paras {
        s.push_str(&para_html(para));
    }
    s.push_str("</main>\n</body>\n</html>\n");
    let mut notes = printdoc::notes(&counts, "HTML");
    if !opts.header.trim().is_empty() || !opts.footer.trim().is_empty() {
        notes.push("Header and footer left out: HTML has no page headers; the browser prints its own.".into());
    }
    notes.push("Page numbers come from the browser when printing. Checked to be valid, escaped HTML; not yet checked in each browser's print view.".into());
    DocExported { bytes: s.into_bytes(), notes }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{BlockKind, Run};
    use crate::numbering::SceneNumber;

    #[test]
    fn escapes_text_and_marks_elements_numbers_and_breaks() {
        let h = Block::new(BlockKind::Heading, "int. lab - night");
        let mut a = Block::new(BlockKind::Action, "");
        a.runs = vec![Run::plain("<script>alert('x')</script> & "), Run { bold: true, ..Run::plain("bold") }];
        let mut d = Block::new(BlockKind::Dialogue, "Line.");
        d.break_before = true;
        let mut numbers = Numbers::new();
        let sid = h.scene_id.clone().unwrap();
        numbers.insert(sid.clone(), SceneNumber { scene_id: sid, number: "12A".into(), omitted: false });
        let out = export(&[h, a, Block::new(BlockKind::Character, "Mara"), d], &Profile::us_letter(), &numbers, None, &DocOptions { title: "Tide & Co".into(), ..Default::default() });
        let s = String::from_utf8(out.bytes).unwrap();
        assert!(!s.contains("<script>") && s.contains("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; "), "text is escaped");
        assert!(s.contains("<title>Tide &amp; Co</title>"));
        assert!(s.contains("<p class=\"scene-heading\"><span class=\"num left\">12A </span><span class=\"num right\" aria-hidden=\"true\">12A</span>INT. LAB - NIGHT"));
        assert!(s.contains("<strong>bold</strong>"));
        assert!(s.contains("<p class=\"dialogue page-break\">"));
        assert!(s.contains("p.dialogue { margin-left: 1.00in; margin-right: 1.50in;"));
        assert!(!s.contains("http"), "nothing to fetch");
    }
}
