//! Compatibility test pack for Milestone 4 (production analysis, reports,
//! stripboard, and character sides).
//!
//! Generates sample production exports into `out/compat-pack-m4/` with an authoritative
//! `MANIFEST.md` of file names, sizes, and FNV-1a 64-bit hashes.

use crate::compat::{fnv64, PackFile};
use crate::layout::Profile;
use crate::report_export::{self, ReportFormat, ReportKind};
use crate::reports::{from_store, ReportScope};
use crate::sides::{generate_sides, SidesMode, SidesOptions};
use crate::store::Store;
use crate::stripboard;
use std::path::{Path, PathBuf};

/// Pack version for M4 production exports.
pub const M4_PACK_VERSION: u32 = 1;

/// Fixed date in exports (2026-01-01 UTC) for deterministic reproducibility.
const PACK_DATE: i64 = 1_767_225_600;

/// Default directory for M4 compatibility pack.
pub fn default_dir(root: &Path) -> PathBuf {
    root.join("out").join(format!("compat-pack-m4-v{M4_PACK_VERSION}"))
}

/// Generate all M4 production exports for a seeded store.
pub fn export_m4_artifacts(store: &Store, doc_id: &str) -> Result<Vec<(String, Vec<u8>)>, String> {
    let p = Profile::us_letter();
    let scope = ReportScope {
        mode: "document".into(),
        documents: vec![doc_id.to_string()],
        include_omitted: false,
    };
    let mut files = Vec::new();

    // 1. StoryScry Reports
    let bundle = from_store(store, &scope).map_err(|e| format!("reports: {e}"))?;

    // 1a. Multi-sheet XLSX workbook
    let all_xlsx = report_export::export_xlsx(&bundle, ReportKind::All)?;
    files.push(("page-boundaries-reports-all.xlsx".into(), all_xlsx));

    // 1b. Scenes report in all formats
    let scenes_csv = report_export::export(&bundle, ReportKind::Scenes, ReportFormat::Csv, &p, PACK_DATE, "compat-m4")?.bytes;
    files.push(("page-boundaries-report-scenes.csv".into(), scenes_csv));

    let scenes_tsv = report_export::export(&bundle, ReportKind::Scenes, ReportFormat::Tsv, &p, PACK_DATE, "compat-m4")?.bytes;
    files.push(("page-boundaries-report-scenes.tsv".into(), scenes_tsv));

    let scenes_xlsx = report_export::export(&bundle, ReportKind::Scenes, ReportFormat::Xlsx, &p, PACK_DATE, "compat-m4")?.bytes;
    files.push(("page-boundaries-report-scenes.xlsx".into(), scenes_xlsx));

    let scenes_html = report_export::export(&bundle, ReportKind::Scenes, ReportFormat::Html, &p, PACK_DATE, "compat-m4")?.bytes;
    files.push(("page-boundaries-report-scenes.html".into(), scenes_html));

    let scenes_pdf = report_export::export(&bundle, ReportKind::Scenes, ReportFormat::Pdf, &p, PACK_DATE, "compat-m4")?.bytes;
    files.push(("page-boundaries-report-scenes.pdf".into(), scenes_pdf));

    let scenes_rtf = report_export::export(&bundle, ReportKind::Scenes, ReportFormat::Rtf, &p, PACK_DATE, "compat-m4")?.bytes;
    files.push(("page-boundaries-report-scenes.rtf".into(), scenes_rtf));

    // 1c. Characters report
    let chars_csv = report_export::export(&bundle, ReportKind::Characters, ReportFormat::Csv, &p, PACK_DATE, "compat-m4")?.bytes;
    files.push(("page-boundaries-report-characters.csv".into(), chars_csv));

    let chars_xlsx = report_export::export(&bundle, ReportKind::Characters, ReportFormat::Xlsx, &p, PACK_DATE, "compat-m4")?.bytes;
    files.push(("page-boundaries-report-characters.xlsx".into(), chars_xlsx));

    let chars_html = report_export::export(&bundle, ReportKind::Characters, ReportFormat::Html, &p, PACK_DATE, "compat-m4")?.bytes;
    files.push(("page-boundaries-report-characters.html".into(), chars_html));

    let chars_pdf = report_export::export(&bundle, ReportKind::Characters, ReportFormat::Pdf, &p, PACK_DATE, "compat-m4")?.bytes;
    files.push(("page-boundaries-report-characters.pdf".into(), chars_pdf));

    // 1d. Locations report
    let locs_csv = report_export::export(&bundle, ReportKind::Locations, ReportFormat::Csv, &p, PACK_DATE, "compat-m4")?.bytes;
    files.push(("page-boundaries-report-locations.csv".into(), locs_csv));

    let locs_xlsx = report_export::export(&bundle, ReportKind::Locations, ReportFormat::Xlsx, &p, PACK_DATE, "compat-m4")?.bytes;
    files.push(("page-boundaries-report-locations.xlsx".into(), locs_xlsx));

    // 2. Stripboard & Shooting Schedule
    let schedule = stripboard::reconcile_schedule(store, &scope).map_err(|e| format!("stripboard: {e}"))?;

    let sb_pdf = stripboard::export_pdf(&schedule, &p, PACK_DATE)?;
    files.push(("page-boundaries-stripboard.pdf".into(), sb_pdf));

    let sb_html = stripboard::export_html(&schedule).into_bytes();
    files.push(("page-boundaries-stripboard.html".into(), sb_html));

    let sb_xlsx = stripboard::export_xlsx(&schedule)?;
    files.push(("page-boundaries-stripboard.xlsx".into(), sb_xlsx));

    let sb_csv = stripboard::export_csv(&schedule, ',').into_bytes();
    files.push(("page-boundaries-stripboard.csv".into(), sb_csv));

    // 3. Character Sides
    // 3a. Ines scenes_only mode
    let ines_only_opts = SidesOptions {
        document_id: Some(doc_id.to_string()),
        characters: vec!["INES".into()],
        mode: SidesMode::ScenesOnly,
        include_title_page: true,
        all_pages: false,
        watermark: Some("AUDITION ONLY".into()),
        custom_header: Some("INES SIDES - PILOT".into()),
    };
    let ines_only_pdf = generate_sides(store, doc_id, &ines_only_opts, &p, PACK_DATE)?;
    files.push(("page-boundaries-sides-ines-only.pdf".into(), ines_only_pdf));

    // 3b. Ines cross_out mode
    let ines_cross_opts = SidesOptions {
        document_id: Some(doc_id.to_string()),
        characters: vec!["INES".into()],
        mode: SidesMode::CrossOut,
        include_title_page: true,
        all_pages: true,
        watermark: None,
        custom_header: None,
    };
    let ines_cross_pdf = generate_sides(store, doc_id, &ines_cross_opts, &p, PACK_DATE)?;
    files.push(("page-boundaries-sides-ines-crossed.pdf".into(), ines_cross_pdf));

    // 3c. Margit dual dialogue sides
    let margit_opts = SidesOptions {
        document_id: Some(doc_id.to_string()),
        characters: vec!["MARGIT".into()],
        mode: SidesMode::ScenesOnly,
        include_title_page: true,
        all_pages: false,
        watermark: Some("DUAL DIALOGUE TEST".into()),
        custom_header: None,
    };
    let margit_pdf = generate_sides(store, doc_id, &margit_opts, &p, PACK_DATE)?;
    files.push(("page-boundaries-sides-dual-margit.pdf".into(), margit_pdf));

    Ok(files)
}

/// Write the M4 compatibility pack and its MANIFEST.md into `dir`.
pub fn write_m4_pack(dir: &Path) -> Result<Vec<PackFile>, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;

    // Create temporary store for export generation
    let tmp_db = std::env::temp_dir().join(format!("cirth-compat-m4-store-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&tmp_db);
    std::fs::create_dir_all(&tmp_db).map_err(|e| e.to_string())?;

    let mut store = Store::open(&tmp_db.join("w.db")).map_err(|e| e.to_string())?;
    let mut doc = crate::fixtures::page_boundaries().to_document()?;

    // Assign deterministic IDs so reports and tables have stable bytes across runs.
    // Invariant: only headings carry a scene_id.
    for (i, b) in doc.blocks.iter_mut().enumerate() {
        b.id = format!("blk_{i:04}");
        if b.kind == crate::model::BlockKind::Heading {
            b.scene_id = Some(format!("sc_{i:04}"));
        } else {
            b.scene_id = None;
        }
    }

    store.seed(&doc).map_err(|e| e.to_string())?;
    store.set_project_id("proj_compat_m4").map_err(|e| e.to_string())?;

    let orig_doc_id = store.default_document().map_err(|e| e.to_string())?;
    let doc_id = "doc_page_boundaries".to_string();
    store.conn.execute("UPDATE documents SET id = ?1 WHERE id = ?2", [&doc_id, &orig_doc_id]).map_err(|e| e.to_string())?;
    store.conn.execute("UPDATE meta SET value = ?1 WHERE key = 'default_document'", [&doc_id]).map_err(|e| e.to_string())?;
    store.conn.execute("UPDATE blocks SET document_id = ?1", [&doc_id]).map_err(|e| e.to_string())?;
    let _ = store.conn.execute("UPDATE meta SET value = ?1 WHERE key = 'current_document'", [&doc_id]);

    store.lock_scene_numbers(&doc_id).map_err(|e| e.to_string())?;

    let raw_files = export_m4_artifacts(&store, &doc_id)?;
    let mut pack_files = Vec::new();

    for (file, bytes) in raw_files {
        let path = dir.join(&file);
        std::fs::write(&path, &bytes).map_err(|e| format!("{file}: {e}"))?;
        pack_files.push(PackFile {
            hash: fnv64(&bytes),
            bytes: bytes.len(),
            name: file,
        });
    }

    let mut m = format!(
        "# Kolbítar M4 production compatibility pack, version {M4_PACK_VERSION}\n\n\
        Generated by `cirth-cli compat-m4`. The same Kolbítar commit produces identical bytes across runs.\n\n\
        Scope: Script `page-boundaries` (US Letter, locked scene numbers 1..N).\n\
        Artifacts: StoryScry reports (XLSX, CSV, TSV, HTML, PDF, RTF), Stripboard (PDF, HTML, XLSX, CSV), and Character Sides (PDF).\n\n\
        | File | Bytes | FNV-1a 64 |\n\
        | - | - | - |\n"
    );

    for f in &pack_files {
        m.push_str(&format!("| {} | {} | `{}` |\n", f.name, f.bytes, f.hash));
    }

    std::fs::write(dir.join("MANIFEST.md"), m).map_err(|e| e.to_string())?;

    let _ = std::fs::remove_dir_all(&tmp_db);
    Ok(pack_files)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_m4_pack_is_complete_repeatable_and_valid() {
        let d = std::env::temp_dir().join(format!("cirth-compat-m4-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);

        let a = write_m4_pack(&d).expect("pack generation succeeds");
        assert_eq!(a.len(), 20, "all 20 production exports generated");

        for f in &a {
            assert!(f.bytes > 0, "file {} must not be empty", f.name);
        }

        // Check repeatability
        let b = write_m4_pack(&d).expect("repeat pack generation succeeds");
        for (x, y) in a.iter().zip(&b) {
            if x.hash != y.hash {
                eprintln!("Difference in {}: a.hash={} b.hash={} a.len={} b.len={}", x.name, x.hash, y.hash, x.bytes, y.bytes);
            }
            assert_eq!((&x.name, &x.hash), (&y.name, &y.hash), "deterministic bytes for {}", x.name);
        }

        // Validate specific formats
        let xlsx_bytes = std::fs::read(d.join("page-boundaries-reports-all.xlsx")).unwrap();
        assert!(xlsx_bytes.starts_with(b"PK"), "XLSX is a valid ZIP archive");

        let pdf_bytes = std::fs::read(d.join("page-boundaries-stripboard.pdf")).unwrap();
        assert!(pdf_bytes.starts_with(b"%PDF-"), "PDF starts with %PDF- header");

        let sides_pdf = std::fs::read(d.join("page-boundaries-sides-ines-only.pdf")).unwrap();
        assert!(sides_pdf.starts_with(b"%PDF-"), "Sides PDF starts with %PDF- header");

        let csv_text = std::fs::read_to_string(d.join("page-boundaries-report-scenes.csv")).unwrap();
        assert!(csv_text.contains("Scene"), "Scenes CSV contains Scene header");

        let html_text = std::fs::read_to_string(d.join("page-boundaries-stripboard.html")).unwrap();
        assert!(html_text.contains("<!DOCTYPE html>"), "Stripboard HTML has doctype");

        let manifest = std::fs::read_to_string(d.join("MANIFEST.md")).unwrap();
        assert!(manifest.contains("page-boundaries-reports-all.xlsx"));
        assert!(manifest.contains(&a[0].hash));

        let _ = std::fs::remove_dir_all(&d);
    }
}
