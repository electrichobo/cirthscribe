//! Compatibility test pack (M2 step 9): every sample script exported in
//! every format, the same bytes on every run, with a manifest of file
//! names, sizes and hashes. Testers open these files in external apps and
//! record results in docs/COMPATIBILITY.md against the manifest, so a
//! result always names the exact file it came from.
//!
//! `cirth-cli compat-pack <dir>` writes it.

use crate::layout::{Profile, paginate_numbered};
use crate::model::Document;
use crate::numbering::{Numbers, SceneNumber};
use crate::printdoc::DocOptions;
use crate::title::TitlePage;
use std::path::{Path, PathBuf};

/// Pack format version: bump when the pack's contents or options change.
pub const PACK_VERSION: u32 = 2;

/// Fixed date in the PDFs (2026-01-01 UTC) so the pack is repeatable.
const PACK_DATE: i64 = 1_767_225_600;

/// 64-bit FNV-1a, enough to tell files apart in a manifest (not security).
pub fn fnv64(bytes: &[u8]) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{h:016x}")
}

fn title_page(title: &str) -> TitlePage {
    TitlePage {
        title: title.to_uppercase(),
        credit: "Written by".into(),
        authors: "Test Writer".into(),
        draft_label: "Compatibility Pack".into(),
        draft_date: "1 January 2026".into(),
        contact: "writer@example.invalid".into(),
        wga: "0000000".into(),
        ..Default::default()
    }
}

fn locked_numbers(doc: &Document) -> Numbers {
    let mut n = Numbers::new();
    for (i, id) in doc.blocks.iter().filter_map(|b| b.scene_id.clone()).enumerate() {
        n.insert(id.clone(), SceneNumber { scene_id: id, number: (i + 1).to_string(), omitted: false });
    }
    n
}

/// One written file: name, size and hash.
pub struct PackFile {
    pub name: String,
    pub bytes: usize,
    pub hash: String,
}

/// Every format of one script (US Letter, title page, locked scene numbers,
/// a header from page 2).
pub fn exports(name: &str, doc: &Document) -> Result<Vec<(String, Vec<u8>)>, String> {
    let p = Profile::us_letter();
    let tp = title_page(&doc.title);
    let numbers = locked_numbers(doc);
    let header = format!("{} - Compatibility Pack", tp.title);
    let map = paginate_numbered(&doc.blocks, &p, 0, &numbers);
    let pdf_opts = crate::pdf::PdfOptions {
        title: tp.title.clone(),
        author: tp.authors.clone(),
        subject: tp.draft_label.clone(),
        date_unix: PACK_DATE,
        document_id: format!("kolbitar-compat-pack-{name}"),
        header: header.clone(),
        footer: String::new(),
        revision_header: String::new(),
    };
    let doc_opts = DocOptions { title: tp.title.clone(), author: tp.authors.clone(), header: header.clone(), footer: String::new() };
    Ok(vec![
        (format!("{name}.pdf"), crate::pdf::render_document(&map, &p, Some(&tp), &pdf_opts)?),
        (format!("{name}.txt"), crate::txt::render_document(&map, &p, Some(&tp), &header, "", "").text.into_bytes()),
        (format!("{name}.fountain"), crate::fountain::export(&doc.blocks, &tp, &numbers).text.into_bytes()),
        (format!("{name}.fdx"), crate::fdx::export(&doc.blocks, &tp, &numbers).text.into_bytes()),
        (format!("{name}.docx"), crate::docx::export(&doc.blocks, &p, &numbers, Some(&tp), &doc_opts)?.bytes),
        (format!("{name}.rtf"), crate::rtf::export(&doc.blocks, &p, &numbers, Some(&tp), &doc_opts).bytes),
        (format!("{name}.html"), crate::html::export(&doc.blocks, &p, &numbers, Some(&tp), &doc_opts).bytes),
    ])
}

/// The sample scripts in the pack.
pub fn samples() -> Result<Vec<(&'static str, Document)>, String> {
    Ok(vec![
        ("page-boundaries", crate::fixtures::page_boundaries().to_document()?),
        ("unicode-marks", crate::fixtures::unicode_marks().to_document()?),
        ("long-120", crate::fixtures::long_script(120).to_document()?),
    ])
}

/// Write the pack and its MANIFEST.md into `dir`.
pub fn write_pack(dir: &Path) -> Result<Vec<PackFile>, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let mut files = Vec::new();
    for (name, doc) in samples()? {
        for (file, bytes) in exports(name, &doc)? {
            std::fs::write(dir.join(&file), &bytes).map_err(|e| format!("{file}: {e}"))?;
            files.push(PackFile { hash: fnv64(&bytes), bytes: bytes.len(), name: file });
        }
    }
    let mut m = format!(
        "# Kolbítar compatibility pack, version {PACK_VERSION}\n\nMade by `cirth-cli compat-pack`. The same Kolbítar commit always makes the same files. Settings for every file: US Letter, a title page, locked scene numbers 1..N, a header from page 2.\n\nRecord each result in docs/COMPATIBILITY.md with the file's hash below, the app and its version, the OS, the date and what you saw.\n\n| File | Bytes | FNV-1a 64 |\n| - | - | - |\n"
    );
    for f in &files {
        m.push_str(&format!("| {} | {} | `{}` |\n", f.name, f.bytes, f.hash));
    }
    std::fs::write(dir.join("MANIFEST.md"), m).map_err(|e| e.to_string())?;
    Ok(files)
}

/// Where `cirth-cli compat-pack` writes by default.
pub fn default_dir(root: &Path) -> PathBuf {
    root.join("out").join(format!("compat-pack-v{PACK_VERSION}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pack_is_complete_and_repeatable() {
        let d = std::env::temp_dir().join(format!("cirth-compat-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        let a = write_pack(&d).unwrap();
        assert_eq!(a.len(), 3 * 7);
        for ext in ["pdf", "txt", "fountain", "fdx", "docx", "rtf", "html"] {
            assert_eq!(a.iter().filter(|f| f.name.ends_with(&format!(".{ext}"))).count(), 3, "{ext}");
        }
        let b = write_pack(&d).unwrap();
        for (x, y) in a.iter().zip(&b) {
            assert_eq!((&x.name, &x.hash), (&y.name, &y.hash), "same bytes every run");
        }
        let manifest = std::fs::read_to_string(d.join("MANIFEST.md")).unwrap();
        assert!(manifest.contains("long-120.docx") && manifest.contains(&a[0].hash));
        // Kolbítar reads its own Fountain and FDX back with the same blocks.
        for (name, doc) in samples().unwrap() {
            let f = crate::fountain::import(&std::fs::read_to_string(d.join(format!("{name}.fountain"))).unwrap(), name);
            let x = crate::fdx::import(&std::fs::read_to_string(d.join(format!("{name}.fdx"))).unwrap(), name).unwrap();
            let texts = |d: &Document| d.blocks.iter().map(|b| (b.kind, b.text())).collect::<Vec<_>>();
            assert_eq!(texts(&f.document), texts(&doc), "{name}: Fountain round trip");
            assert_eq!(texts(&x.document), texts(&doc), "{name}: FDX round trip");
        }
        let _ = std::fs::remove_dir_all(&d);
    }
}
