//! DOCX export (Word, Google Docs profile): a real WordprocessingML package
//! written with `zip`. One paragraph style per screenplay element carries
//! the indents and spacing of the layout profile; paper size and margins
//! are explicit; text stays editable (no tabs or spaces for alignment, no
//! page images). Courier Prime 12 pt is named as the font: Google Docs and
//! Word use it when available and substitute otherwise.
//!
//! A title page is its own section with no header; the script section
//! starts page numbering at 1 and shows no number on its first page, like
//! the PDF. Headers and footers use the PAGE field, so the opening app
//! numbers its own pages.

use crate::layout::Profile;
use crate::model::Block;
use crate::numbering::Numbers;
use crate::printdoc::{self, DocExported, DocOptions, Para, TitleAlign};
use crate::title::TitlePage;
use std::io::Write;

const TWIP: f32 = 1440.0;

fn tw(inches: f32) -> i64 {
    (inches * TWIP).round() as i64
}

fn esc(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for c in s.chars().filter(|c| printdoc::xml_safe(*c)) {
        match c {
            '&' => o.push_str("&amp;"),
            '<' => o.push_str("&lt;"),
            '>' => o.push_str("&gt;"),
            '"' => o.push_str("&quot;"),
            _ => o.push(c),
        }
    }
    o
}

fn style_id(name: &str) -> String {
    name.replace(' ', "")
}

fn run(text: &str, bold: bool, italic: bool, underline: bool) -> String {
    let mut props = String::new();
    if bold {
        props.push_str("<w:b/>");
    }
    if italic {
        props.push_str("<w:i/>");
    }
    if underline {
        props.push_str("<w:u w:val=\"single\"/>");
    }
    let rpr = if props.is_empty() { String::new() } else { format!("<w:rPr>{props}</w:rPr>") };
    // Line breaks inside a block become <w:br/>; tabs become <w:tab/>.
    let mut body = String::new();
    for (i, line) in text.split('\n').enumerate() {
        if i > 0 {
            body.push_str("<w:br/>");
        }
        for (k, part) in line.split('\t').enumerate() {
            if k > 0 {
                body.push_str("<w:tab/>");
            }
            if !part.is_empty() {
                body.push_str(&format!("<w:t xml:space=\"preserve\">{}</w:t>", esc(part)));
            }
        }
    }
    format!("<w:r>{rpr}{body}</w:r>")
}

fn para_xml(p: &Para) -> String {
    let mut ppr = format!("<w:pStyle w:val=\"{}\"/>", style_id(printdoc::style_name(p.kind)));
    if p.break_before {
        ppr.push_str("<w:pageBreakBefore/>");
    }
    let mut body = String::new();
    if let Some(n) = &p.number {
        // The number hangs in the left margin, then a tab to the text.
        ppr.push_str("<w:tabs><w:tab w:val=\"left\" w:pos=\"0\"/></w:tabs><w:ind w:left=\"0\" w:hanging=\"1080\"/>");
        body.push_str(&run(n, false, false, false));
        body.push_str("<w:r><w:tab/></w:r>");
    }
    for r in &p.runs {
        body.push_str(&run(&r.text, r.bold, r.italic, r.underline));
    }
    format!("<w:p><w:pPr>{ppr}</w:pPr>{body}</w:p>")
}

fn page_setup(p: &Profile, with_furniture: bool, title_pg: bool) -> String {
    let refs = if with_furniture { "<w:headerReference w:type=\"default\" r:id=\"rIdHeader\"/><w:footerReference w:type=\"default\" r:id=\"rIdFooter\"/>" } else { "" };
    let first = if title_pg { "<w:titlePg/>" } else { "" };
    format!(
        "{refs}<w:pgSz w:w=\"{}\" w:h=\"{}\"/><w:pgMar w:top=\"{}\" w:right=\"{}\" w:bottom=\"{}\" w:left=\"{}\" w:header=\"720\" w:footer=\"720\" w:gutter=\"0\"/><w:pgNumType w:start=\"1\"/>{first}",
        tw(p.page_w_in),
        tw(p.page_h_in),
        tw(p.top_in),
        tw(1.0),
        tw(p.bottom_in),
        tw(p.action.left_in)
    )
}

fn styles_xml(p: &Profile) -> String {
    let mut s = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<w:styles xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">\
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii=\"Courier Prime\" w:hAnsi=\"Courier Prime\" w:eastAsia=\"Courier Prime\" w:cs=\"Courier Prime\"/><w:sz w:val=\"24\"/><w:szCs w:val=\"24\"/><w:lang w:val=\"en-US\"/></w:rPr></w:rPrDefault>\
<w:pPrDefault><w:pPr><w:spacing w:before=\"0\" w:after=\"0\" w:line=\"240\" w:lineRule=\"exact\"/></w:pPr></w:pPrDefault></w:docDefaults>\
<w:style w:type=\"paragraph\" w:default=\"1\" w:styleId=\"Normal\"><w:name w:val=\"Normal\"/><w:qFormat/></w:style>",
    );
    for kind in crate::model::BlockKind::ALL {
        let g = printdoc::geom(p, kind);
        let name = printdoc::style_name(kind);
        let mut ppr = format!("<w:spacing w:before=\"{}\"/><w:ind w:left=\"{}\" w:right=\"{}\"/>", g.space_before * 240, tw(g.left_in), tw(g.right_in));
        if g.keep_with_next {
            ppr.push_str("<w:keepNext/>");
        }
        if g.right_aligned {
            ppr.push_str("<w:jc w:val=\"right\"/>");
        }
        let rpr = if g.italic { "<w:rPr><w:i/></w:rPr>" } else { "" };
        s.push_str(&format!(
            "<w:style w:type=\"paragraph\" w:customStyle=\"1\" w:styleId=\"{}\"><w:name w:val=\"{name}\"/><w:basedOn w:val=\"Normal\"/><w:next w:val=\"Action\"/><w:qFormat/><w:pPr>{ppr}</w:pPr>{rpr}</w:style>",
            style_id(name)
        ));
    }
    for (id, name) in [("TitlePage", "Title Page"), ("Header", "header"), ("Footer", "footer")] {
        s.push_str(&format!("<w:style w:type=\"paragraph\" w:styleId=\"{id}\"><w:name w:val=\"{name}\"/><w:basedOn w:val=\"Normal\"/></w:style>"));
    }
    s.push_str("</w:styles>");
    s
}

const NS: &str = "xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"";

fn header_xml(text: &str, p: &Profile) -> String {
    // Header text at the left, "N." at the right edge of the text column.
    let left = if text.is_empty() { String::new() } else { run(text, false, false, false) };
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<w:hdr {NS}><w:p><w:pPr><w:pStyle w:val=\"Header\"/><w:tabs><w:tab w:val=\"right\" w:pos=\"{}\"/></w:tabs></w:pPr>{left}<w:r><w:tab/></w:r><w:fldSimple w:instr=\" PAGE \"><w:r><w:t>2</w:t></w:r></w:fldSimple><w:r><w:t>.</w:t></w:r></w:p></w:hdr>",
        tw(printdoc::column_in(p))
    )
}

fn footer_xml(text: &str) -> String {
    let body = if text.is_empty() { String::new() } else { run(text, false, false, false) };
    format!("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<w:ftr {NS}><w:p><w:pPr><w:pStyle w:val=\"Footer\"/><w:jc w:val=\"center\"/></w:pPr>{body}</w:p></w:ftr>")
}

fn document_xml(paras: &[Para], title: Option<&TitlePage>, p: &Profile) -> String {
    let mut body = String::new();
    if let Some(tp) = title.filter(|t| !t.is_empty()) {
        for t in printdoc::title_paras(tp, p) {
            let jc = match t.align {
                TitleAlign::Centre => "center",
                TitleAlign::Left => "left",
                TitleAlign::Right => "right",
            };
            body.push_str(&format!(
                "<w:p><w:pPr><w:pStyle w:val=\"TitlePage\"/><w:spacing w:before=\"{}\"/><w:jc w:val=\"{jc}\"/></w:pPr>{}</w:p>",
                t.space_before * 240,
                run(&t.text, false, false, false)
            ));
        }
        // Section break: the title page has no header or footer.
        body.push_str(&format!("<w:p><w:pPr><w:sectPr>{}</w:sectPr></w:pPr></w:p>", page_setup(p, false, false)));
    }
    for para in paras {
        body.push_str(&para_xml(para));
    }
    if paras.is_empty() {
        body.push_str("<w:p/>");
    }
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<w:document {NS}><w:body>{body}<w:sectPr>{}</w:sectPr></w:body></w:document>",
        page_setup(p, true, true)
    )
}

const CONTENT_TYPES: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">\
<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>\
<Default Extension=\"xml\" ContentType=\"application/xml\"/>\
<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>\
<Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/>\
<Override PartName=\"/word/header1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml\"/>\
<Override PartName=\"/word/footer1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml\"/>\
<Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/>\
<Override PartName=\"/docProps/app.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.extended-properties+xml\"/>\
</Types>";

const ROOT_RELS: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>\
<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" Target=\"docProps/core.xml\"/>\
<Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties\" Target=\"docProps/app.xml\"/>\
</Relationships>";

const DOC_RELS: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
<Relationship Id=\"rIdStyles\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>\
<Relationship Id=\"rIdHeader\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/header\" Target=\"header1.xml\"/>\
<Relationship Id=\"rIdFooter\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer\" Target=\"footer1.xml\"/>\
</Relationships>";

fn core_xml(opts: &DocOptions) -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\"><dc:title>{}</dc:title><dc:creator>{}</dc:creator></cp:coreProperties>",
        esc(&opts.title),
        esc(&opts.author)
    )
}

const APP_XML: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Properties xmlns=\"http://schemas.openxmlformats.org/officeDocument/2006/extended-properties\"><Application>Kolbítar</Application></Properties>";

/// The whole package. Entry order and timestamps are fixed, so the same
/// script gives the same bytes.
pub fn export(blocks: &[Block], p: &Profile, numbers: &Numbers, title_page: Option<&TitlePage>, opts: &DocOptions) -> Result<DocExported, String> {
    let (paras, counts) = printdoc::paras(blocks, p, numbers);
    let parts: [(&str, String); 8] = [
        ("[Content_Types].xml", CONTENT_TYPES.to_string()),
        ("_rels/.rels", ROOT_RELS.to_string()),
        ("word/document.xml", document_xml(&paras, title_page, p)),
        ("word/_rels/document.xml.rels", DOC_RELS.to_string()),
        ("word/styles.xml", styles_xml(p)),
        ("word/header1.xml", header_xml(opts.header.trim(), p)),
        ("word/footer1.xml", footer_xml(opts.footer.trim())),
        ("docProps/core.xml", core_xml(opts)),
    ];
    let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let fixed = zip::DateTime::from_date_and_time(2000, 1, 1, 0, 0, 0).map_err(|e| e.to_string())?;
    let o = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated).last_modified_time(fixed);
    for (name, xml) in parts.iter().map(|(n, x)| (*n, x.as_str())).chain(std::iter::once(("docProps/app.xml", APP_XML))) {
        zip.start_file(name, o).map_err(|e| e.to_string())?;
        zip.write_all(xml.as_bytes()).map_err(|e| e.to_string())?;
    }
    let bytes = zip.finish().map_err(|e| e.to_string())?.into_inner();
    let mut notes = printdoc::notes(&counts, "DOCX");
    notes.push("Written for Word and Google Docs (Courier Prime 12 pt, explicit paper size and margins, one style per element). Not yet checked in Word or Google Docs themselves.".into());
    Ok(DocExported { bytes, notes })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{BlockKind, Run};
    use std::io::Read;

    fn sample() -> Vec<Block> {
        let mut a = Block::new(BlockKind::Action, "");
        a.runs = vec![Run::plain("A & B <tag> "), Run { bold: true, ..Run::plain("bold") }];
        vec![Block::new(BlockKind::Heading, "int. lab - night"), a, Block::new(BlockKind::Character, "Mara"), Block::new(BlockKind::Dialogue, "Line one.")]
    }

    fn part(bytes: &[u8], name: &str) -> String {
        let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();
        let mut s = String::new();
        z.by_name(name).unwrap().read_to_string(&mut s).unwrap();
        s
    }

    #[test]
    fn writes_a_well_formed_package_with_styles_and_escaped_text() {
        let p = Profile::us_letter();
        let tp = TitlePage { title: "TIDE".into(), ..Default::default() };
        let out = export(&sample(), &p, &Numbers::new(), Some(&tp), &DocOptions { title: "Tide".into(), header: "TIDE - Draft".into(), ..Default::default() }).unwrap();
        for name in ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/_rels/document.xml.rels", "word/styles.xml", "word/header1.xml", "word/footer1.xml", "docProps/core.xml", "docProps/app.xml"] {
            let xml = part(&out.bytes, name);
            let mut r = quick_xml::Reader::from_str(&xml);
            loop {
                match r.read_event() {
                    Ok(quick_xml::events::Event::Eof) => break,
                    Err(e) => panic!("{name} is not well formed: {e}"),
                    _ => {}
                }
            }
        }
        let doc = part(&out.bytes, "word/document.xml");
        assert!(doc.contains("A &amp; B &lt;tag&gt; "), "escaped");
        assert!(doc.contains("<w:pStyle w:val=\"SceneHeading\"/>") && doc.contains("INT. LAB - NIGHT"), "upper-case heading with its style");
        assert!(doc.contains("<w:b/>"), "bold kept");
        assert!(doc.contains("w:w=\"12240\" w:h=\"15840\""), "US Letter");
        assert_eq!(doc.matches("<w:sectPr>").count(), 2, "title page section and script section");
        let styles = part(&out.bytes, "word/styles.xml");
        assert!(styles.contains("Courier Prime") && styles.contains("w:styleId=\"Dialogue\"") && styles.contains("<w:ind w:left=\"1440\" w:right=\"2160\"/>"), "dialogue indents 1 in / 1.5 in");
        assert!(part(&out.bytes, "word/header1.xml").contains("TIDE - Draft"));
    }

    #[test]
    fn same_script_gives_the_same_bytes() {
        let p = Profile::a4();
        let a = export(&sample(), &p, &Numbers::new(), None, &DocOptions::default()).unwrap();
        let b = export(&sample(), &p, &Numbers::new(), None, &DocOptions::default()).unwrap();
        assert_eq!(a.bytes, b.bytes);
        assert!(part(&a.bytes, "word/document.xml").contains("w:w=\"11909\""), "A4 width");
    }
}
