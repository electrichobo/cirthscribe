//! Report exports (M4 step 2, ACCEPTANCE E1, E8, E9; INTEROPERABILITY Google Sheets profile).
//!
//! Exports any single report from a `ReportBundle` (or all seven reports as a
//! multi-sheet XLSX workbook or multi-section document) in CSV, TSV, XLSX,
//! HTML, PDF and RTF.
//!
//! Rules enforced here:
//! - Every report is independently selectable and exportable.
//! - Every export states the report's scope (`scope_label`), source script
//!   version (`source_version`), planning version (`planning_version`) and
//!   estimate notes (page and eighth lengths are layout estimates).
//! - Tabular exports (CSV, TSV, XLSX) include dedicated columns for both
//!   human-readable scene numbers and stable source IDs (`document_id`,
//!   `scene_id`, `set_id`).
//! - Numbers are written as typed numbers (`t="n"`) in XLSX so spreadsheet
//!   sums and charts work directly without text conversion.
//! - Text cells that start with `=`, `+`, `-`, `@`, `\t` or `\r` (excluding
//!   plain negative numbers) are prefixed with a leading apostrophe in CSV,
//!   TSV and XLSX to prevent spreadsheet formula injection.
//! - XLSX packages are written with the approved `zip` crate with fixed Unix
//!   0644 permissions and a fixed timestamp so identical input produces
//!   byte-identical output across Windows, macOS and Linux.

use std::io::Write;

use serde::{Deserialize, Serialize};

use crate::layout::{self, PLine, Page, PageMap, Profile, Seg};
use crate::pdf::{self, PdfOptions};
use crate::printdoc;
use crate::reports::{BucketRow, ReportBundle};

/// Which report to export (`All` bundles all 7 reports into one workbook or document).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReportKind {
    All,
    Scenes,
    Characters,
    Locations,
    ActionDialogue,
    IntExt,
    DayNight,
    Revisions,
}

impl ReportKind {
    pub const SINGLE: [ReportKind; 7] = [
        ReportKind::Scenes,
        ReportKind::Characters,
        ReportKind::Locations,
        ReportKind::ActionDialogue,
        ReportKind::IntExt,
        ReportKind::DayNight,
        ReportKind::Revisions,
    ];

    pub fn parse(s: &str) -> Result<Self, String> {
        match s {
            "all" | "dashboard" => Ok(ReportKind::All),
            "scenes" => Ok(ReportKind::Scenes),
            "characters" => Ok(ReportKind::Characters),
            "locations" => Ok(ReportKind::Locations),
            "action_dialogue" => Ok(ReportKind::ActionDialogue),
            "int_ext" => Ok(ReportKind::IntExt),
            "day_night" => Ok(ReportKind::DayNight),
            "revisions" => Ok(ReportKind::Revisions),
            other => Err(format!("unknown report kind: {other}")),
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            ReportKind::All => "all",
            ReportKind::Scenes => "scenes",
            ReportKind::Characters => "characters",
            ReportKind::Locations => "locations",
            ReportKind::ActionDialogue => "action_dialogue",
            ReportKind::IntExt => "int_ext",
            ReportKind::DayNight => "day_night",
            ReportKind::Revisions => "revisions",
        }
    }

    pub fn title(self) -> &'static str {
        match self {
            ReportKind::All => "All Reports",
            ReportKind::Scenes => "Scenes Report",
            ReportKind::Characters => "Characters Report",
            ReportKind::Locations => "Locations Report",
            ReportKind::ActionDialogue => "Action vs Dialogue Report",
            ReportKind::IntExt => "Interior vs Exterior Report",
            ReportKind::DayNight => "Day vs Night Report",
            ReportKind::Revisions => "Revisions Report",
        }
    }

    /// Worksheet tab name (<= 31 chars, no `:` `\` `/` `?` `*` `[` `]`).
    pub fn sheet_name(self) -> &'static str {
        match self {
            ReportKind::All => "Summary",
            ReportKind::Scenes => "Scenes",
            ReportKind::Characters => "Characters",
            ReportKind::Locations => "Locations",
            ReportKind::ActionDialogue => "Action vs Dialogue",
            ReportKind::IntExt => "Interior vs Exterior",
            ReportKind::DayNight => "Day vs Night",
            ReportKind::Revisions => "Revisions",
        }
    }
}

/// Output format for a report export.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReportFormat {
    Csv,
    Tsv,
    Xlsx,
    Html,
    Pdf,
    Rtf,
}

impl ReportFormat {
    pub fn parse(s: &str) -> Result<Self, String> {
        match s {
            "csv" => Ok(ReportFormat::Csv),
            "tsv" => Ok(ReportFormat::Tsv),
            "xlsx" => Ok(ReportFormat::Xlsx),
            "html" => Ok(ReportFormat::Html),
            "pdf" => Ok(ReportFormat::Pdf),
            "rtf" => Ok(ReportFormat::Rtf),
            other => Err(format!("unknown report format: {other}")),
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            ReportFormat::Csv => "csv",
            ReportFormat::Tsv => "tsv",
            ReportFormat::Xlsx => "xlsx",
            ReportFormat::Html => "html",
            ReportFormat::Pdf => "pdf",
            ReportFormat::Rtf => "rtf",
        }
    }
}

/// Typed cell value so spreadsheets receive real numbers and booleans.
#[derive(Clone, Debug, PartialEq)]
pub enum Cell {
    Text(String),
    Int(i64),
    Float(f64),
    Bool(bool),
}

impl Cell {
    pub fn text(s: impl Into<String>) -> Self {
        Cell::Text(s.into())
    }

    pub fn display_text(&self) -> String {
        match self {
            Cell::Text(s) => s.clone(),
            Cell::Int(n) => n.to_string(),
            Cell::Float(f) => {
                if (f.fract()).abs() < 1e-9 {
                    format!("{f:.1}")
                } else {
                    format!("{:.1}", (f * 10.0).round() / 10.0)
                }
            }
            Cell::Bool(b) => if *b { "true".into() } else { "false".into() },
        }
    }
}

/// One normalized report table ready for any serializer.
#[derive(Clone, Debug)]
pub struct ReportTable {
    pub kind: ReportKind,
    pub title: String,
    pub scope_label: String,
    pub source_version: u64,
    pub planning_version: u64,
    pub total_pages: usize,
    pub total_eighths: u32,
    pub subtitle: String,
    /// Full columns (including stable IDs) for CSV, TSV and XLSX.
    pub headers: Vec<String>,
    pub rows: Vec<Vec<Cell>>,
    /// Human-readable columns for print/view formats (HTML, PDF, RTF).
    pub print_headers: Vec<String>,
    pub print_rows: Vec<Vec<String>>,
}

/// Format eighths of a page as `1 3/8` or `5/8` (matches the UI's `eighths`).
pub fn fmt_eighths(e: u32) -> String {
    let whole = e / 8;
    let rem = e % 8;
    match (whole, rem) {
        (0, 0) => "0".into(),
        (0, r) => format!("{r}/8"),
        (w, 0) => format!("{w}"),
        (w, r) => format!("{w} {r}/8"),
    }
}

/// Prevent formula injection in spreadsheets: prefix text starting with
/// `=`, `+`, `-`, `@`, `\t` or `\r` with `'`.
pub fn formula_safe(s: &str) -> String {
    if let Some(first) = s.chars().next() {
        if matches!(first, '=' | '+' | '-' | '@' | '\t' | '\r') {
            return format!("'{s}");
        }
    }
    s.to_string()
}

/// Build the `ReportTable` for a specific `ReportKind` from a `ReportBundle`.
pub fn build_table(bundle: &ReportBundle, kind: ReportKind) -> ReportTable {
    let multi = bundle.documents.len() > 1;
    match kind {
        ReportKind::All | ReportKind::Scenes => scenes_table(bundle, multi),
        ReportKind::Characters => characters_table(bundle, multi),
        ReportKind::Locations => locations_table(bundle, multi),
        ReportKind::ActionDialogue => action_dialogue_table(bundle, multi),
        ReportKind::IntExt => bucket_table(bundle, ReportKind::IntExt, "Setting (INT/EXT)", &bundle.int_ext),
        ReportKind::DayNight => bucket_table(bundle, ReportKind::DayNight, "Time of Day", &bundle.day_night),
        ReportKind::Revisions => revisions_table(bundle, multi),
    }
}

/// Build all seven report tables in standard order.
pub fn build_all_tables(bundle: &ReportBundle) -> Vec<ReportTable> {
    ReportKind::SINGLE.iter().map(|&k| build_table(bundle, k)).collect()
}

fn base_table(bundle: &ReportBundle, kind: ReportKind, subtitle: String) -> ReportTable {
    ReportTable {
        kind,
        title: kind.title().into(),
        scope_label: bundle.scope_label.clone(),
        source_version: bundle.source_version,
        planning_version: bundle.planning_version,
        total_pages: bundle.total_pages,
        total_eighths: bundle.total_eighths,
        subtitle,
        headers: Vec::new(),
        rows: Vec::new(),
        print_headers: Vec::new(),
        print_rows: Vec::new(),
    }
}

fn scenes_table(b: &ReportBundle, multi: bool) -> ReportTable {
    let mut t = base_table(
        b,
        ReportKind::Scenes,
        format!(
            "{} scene{} · {} page{} · scenes sum to ≈ {} pages (estimate)",
            b.scenes.len(),
            if b.scenes.len() == 1 { "" } else { "s" },
            b.total_pages,
            if b.total_pages == 1 { "" } else { "s" },
            fmt_eighths(b.total_eighths),
        ),
    );
    t.headers = vec![
        "Scene Number".into(),
        "Omitted".into(),
        "INT/EXT".into(),
        "Location".into(),
        "Time of Day".into(),
        "Heading".into(),
        "Page".into(),
        "Length (eighths, est.)".into(),
        "Length (pages, est.)".into(),
        "Speakers".into(),
        "Dual Dialogue Pairs".into(),
        "Beat Logline".into(),
        "Document Title".into(),
        "Document ID".into(),
        "Scene ID".into(),
    ];
    for r in &b.scenes {
        t.rows.push(vec![
            Cell::text(&r.number),
            Cell::Bool(r.omitted),
            Cell::text(&r.int_ext),
            Cell::text(&r.location),
            Cell::text(&r.time_of_day),
            Cell::text(&r.heading),
            Cell::text(&r.page),
            Cell::Int(r.eighths as i64),
            Cell::text(fmt_eighths(r.eighths)),
            Cell::text(r.speakers.join(", ")),
            Cell::Int(r.dual_pairs as i64),
            Cell::text(&r.logline),
            Cell::text(&r.document_title),
            Cell::text(&r.document_id),
            Cell::text(&r.scene_id),
        ]);
    }
    t.print_headers = if multi {
        vec!["Script".into(), "#".into(), "INT/EXT".into(), "Location".into(), "Time".into(), "Page".into(), "Length (est.)".into(), "Speakers".into(), "Logline".into()]
    } else {
        vec!["#".into(), "INT/EXT".into(), "Location".into(), "Time".into(), "Page".into(), "Length (est.)".into(), "Speakers".into(), "Logline".into()]
    };
    for r in &b.scenes {
        let num = if r.omitted { format!("{} (omitted)", r.number) } else { r.number.clone() };
        let sp = if r.dual_pairs > 0 {
            format!("{} ({} dual)", r.speakers.join(", "), r.dual_pairs)
        } else {
            r.speakers.join(", ")
        };
        let mut row = Vec::new();
        if multi {
            row.push(r.document_title.clone());
        }
        row.extend([
            num,
            r.int_ext.clone(),
            if r.location.is_empty() { r.heading.clone() } else { r.location.clone() },
            r.time_of_day.clone(),
            r.page.clone(),
            format!("{} p", fmt_eighths(r.eighths)),
            sp,
            r.logline.clone(),
        ]);
        t.print_rows.push(row);
    }
    t
}

fn characters_table(b: &ReportBundle, multi: bool) -> ReportTable {
    let mut t = base_table(
        b,
        ReportKind::Characters,
        format!("{} speaking character{}", b.characters.len(), if b.characters.len() == 1 { "" } else { "s" }),
    );
    t.headers = vec![
        "Character".into(),
        "Speeches".into(),
        "Dual Speeches".into(),
        "Dialogue Words".into(),
        "Share of Dialogue (%)".into(),
        "Scenes Speaking".into(),
        "First Appearance Scene".into(),
        "First Appearance Page".into(),
        "First Document Title".into(),
        "First Document ID".into(),
        "First Scene ID".into(),
    ];
    for c in &b.characters {
        t.rows.push(vec![
            Cell::text(&c.name),
            Cell::Int(c.speeches as i64),
            Cell::Int(c.dual_speeches as i64),
            Cell::Int(c.words as i64),
            Cell::Float(c.share_pct),
            Cell::Int(c.scenes as i64),
            Cell::text(&c.first_scene_number),
            Cell::text(&c.first_page),
            Cell::text(&c.first_document_title),
            Cell::text(&c.first_document_id),
            Cell::text(&c.first_scene_id),
        ]);
    }
    t.print_headers = vec![
        "Character".into(),
        "Speeches".into(),
        "Dialogue words".into(),
        "Share %".into(),
        "Scenes".into(),
        "First appearance".into(),
    ];
    for c in &b.characters {
        let sp = if c.dual_speeches > 0 { format!("{} ({} dual)", c.speeches, c.dual_speeches) } else { c.speeches.to_string() };
        let first = if multi {
            format!("{} · Sc {} (p. {})", c.first_document_title, c.first_scene_number, c.first_page)
        } else {
            format!("Sc {} (p. {})", c.first_scene_number, c.first_page)
        };
        t.print_rows.push(vec![c.name.clone(), sp, c.words.to_string(), format!("{:.1}%", c.share_pct), c.scenes.to_string(), first]);
    }
    t
}

fn locations_table(b: &ReportBundle, multi: bool) -> ReportTable {
    let mut t = base_table(
        b,
        ReportKind::Locations,
        format!("{} location{}", b.locations.len(), if b.locations.len() == 1 { "" } else { "s" }),
    );
    t.headers = vec![
        "Location".into(),
        "INT/EXT".into(),
        "Scenes".into(),
        "Length (eighths, est.)".into(),
        "Length (pages, est.)".into(),
        "First Use Scene".into(),
        "First Use Page".into(),
        "First Document Title".into(),
        "First Document ID".into(),
        "First Scene ID".into(),
        "Last Use Scene".into(),
        "Last Use Page".into(),
        "Last Document Title".into(),
        "Last Document ID".into(),
        "Last Scene ID".into(),
    ];
    for l in &b.locations {
        t.rows.push(vec![
            Cell::text(&l.name),
            Cell::text(&l.int_ext),
            Cell::Int(l.scenes as i64),
            Cell::Int(l.eighths as i64),
            Cell::text(fmt_eighths(l.eighths)),
            Cell::text(&l.first_scene_number),
            Cell::text(&l.first_page),
            Cell::text(&l.first_document_title),
            Cell::text(&l.first_document_id),
            Cell::text(&l.first_scene_id),
            Cell::text(&l.last_scene_number),
            Cell::text(&l.last_page),
            Cell::text(&l.last_document_title),
            Cell::text(&l.last_document_id),
            Cell::text(&l.last_scene_id),
        ]);
    }
    t.print_headers = vec![
        "Location".into(),
        "INT/EXT".into(),
        "Scenes".into(),
        "Length (est.)".into(),
        "First use".into(),
        "Last use".into(),
    ];
    for l in &b.locations {
        let first = if multi {
            format!("{} · Sc {} (p. {})", l.first_document_title, l.first_scene_number, l.first_page)
        } else {
            format!("Sc {} (p. {})", l.first_scene_number, l.first_page)
        };
        let last = if multi {
            format!("{} · Sc {} (p. {})", l.last_document_title, l.last_scene_number, l.last_page)
        } else {
            format!("Sc {} (p. {})", l.last_scene_number, l.last_page)
        };
        t.print_rows.push(vec![
            l.name.clone(),
            l.int_ext.clone(),
            l.scenes.to_string(),
            format!("{} p", fmt_eighths(l.eighths)),
            first,
            last,
        ]);
    }
    t
}

fn action_dialogue_table(b: &ReportBundle, multi: bool) -> ReportTable {
    let ad = &b.action_dialogue;
    let mut t = base_table(
        b,
        ReportKind::ActionDialogue,
        format!(
            "Overall: Action {} words ({:.1}%), {} lines ({:.1}%) · Dialogue {} words ({:.1}%), {} lines ({:.1}%)",
            ad.action_words, ad.action_word_pct, ad.action_lines, ad.action_line_pct, ad.dialogue_words, ad.dialogue_word_pct, ad.dialogue_lines, ad.dialogue_line_pct
        ),
    );
    t.headers = vec![
        "Scene Number".into(),
        "Heading".into(),
        "Page".into(),
        "Length (eighths, est.)".into(),
        "Action Words".into(),
        "Dialogue Words".into(),
        "Action Lines".into(),
        "Dialogue Lines".into(),
        "Dialogue Word (%)".into(),
        "Document Title".into(),
        "Document ID".into(),
        "Scene ID".into(),
    ];
    for s in &ad.scenes {
        t.rows.push(vec![
            Cell::text(&s.number),
            Cell::text(&s.heading),
            Cell::text(&s.page),
            Cell::Int(s.eighths as i64),
            Cell::Int(s.action_words as i64),
            Cell::Int(s.dialogue_words as i64),
            Cell::Int(s.action_lines as i64),
            Cell::Int(s.dialogue_lines as i64),
            Cell::Float(s.dialogue_word_pct),
            Cell::text(&s.document_title),
            Cell::text(&s.document_id),
            Cell::text(&s.scene_id),
        ]);
    }
    t.print_headers = if multi {
        vec!["Script".into(), "#".into(), "Scene".into(), "Action words".into(), "Dialogue words".into(), "Action lines".into(), "Dialogue lines".into(), "Dialogue %".into()]
    } else {
        vec!["#".into(), "Scene".into(), "Action words".into(), "Dialogue words".into(), "Action lines".into(), "Dialogue lines".into(), "Dialogue %".into()]
    };
    for s in &ad.scenes {
        let mut row = Vec::new();
        if multi {
            row.push(s.document_title.clone());
        }
        row.extend([
            s.number.clone(),
            s.heading.clone(),
            s.action_words.to_string(),
            s.dialogue_words.to_string(),
            s.action_lines.to_string(),
            s.dialogue_lines.to_string(),
            format!("{:.1}%", s.dialogue_word_pct),
        ]);
        t.print_rows.push(row);
    }
    t
}

fn bucket_table(b: &ReportBundle, kind: ReportKind, col_label: &str, rows: &[BucketRow]) -> ReportTable {
    let summary = rows.iter().map(|r| format!("{} {}", r.label, r.scenes)).collect::<Vec<_>>().join(" · ");
    let mut t = base_table(b, kind, summary);
    t.headers = vec![
        col_label.into(),
        "Scenes".into(),
        "Scene Share (%)".into(),
        "Length (eighths, est.)".into(),
        "Length (pages, est.)".into(),
        "Length Share (%, est.)".into(),
    ];
    t.print_headers = vec![
        col_label.into(),
        "Scenes".into(),
        "Scene %".into(),
        "Length (est.)".into(),
        "Length % (est.)".into(),
    ];
    for r in rows {
        t.rows.push(vec![
            Cell::text(&r.label),
            Cell::Int(r.scenes as i64),
            Cell::Float(r.scene_pct),
            Cell::Int(r.eighths as i64),
            Cell::text(fmt_eighths(r.eighths)),
            Cell::Float(r.eighths_pct),
        ]);
        t.print_rows.push(vec![
            r.label.clone(),
            r.scenes.to_string(),
            format!("{:.1}%", r.scene_pct),
            format!("{} p", fmt_eighths(r.eighths)),
            format!("{:.1}%", r.eighths_pct),
        ]);
    }
    t
}

fn revisions_table(b: &ReportBundle, multi: bool) -> ReportTable {
    let mut t = base_table(
        b,
        ReportKind::Revisions,
        format!("{} revision set{}", b.revisions.len(), if b.revisions.len() == 1 { "" } else { "s" }),
    );
    t.headers = vec![
        "Revision Set".into(),
        "Colour".into(),
        "Mark".into(),
        "Date".into(),
        "Author".into(),
        "Active".into(),
        "Changed Pages".into(),
        "Changed Page Labels".into(),
        "Revised Passages".into(),
        "Document Title".into(),
        "Document ID".into(),
        "Revision Set ID".into(),
    ];
    for r in &b.revisions {
        t.rows.push(vec![
            Cell::text(&r.label),
            Cell::text(&r.colour),
            Cell::text(&r.mark),
            Cell::text(&r.date),
            Cell::text(&r.author),
            Cell::Bool(r.active),
            Cell::Int(r.changed_pages as i64),
            Cell::text(r.page_labels.join(", ")),
            Cell::Int(r.passages as i64),
            Cell::text(&r.document_title),
            Cell::text(&r.document_id),
            Cell::text(&r.set_id),
        ]);
    }
    t.print_headers = if multi {
        vec!["Script".into(), "Revision set".into(), "Colour".into(), "Mark".into(), "Date".into(), "Changed pages".into(), "Revised passages".into()]
    } else {
        vec!["Revision set".into(), "Colour".into(), "Mark".into(), "Date".into(), "Changed pages".into(), "Revised passages".into()]
    };
    for r in &b.revisions {
        let mut row = Vec::new();
        if multi {
            row.push(r.document_title.clone());
        }
        row.extend([
            if r.active { format!("{} (active)", r.label) } else { r.label.clone() },
            r.colour.clone(),
            r.mark.clone(),
            if r.date.is_empty() { "—".into() } else { r.date.clone() },
            if r.changed_pages > 0 { format!("{} ({})", r.changed_pages, r.page_labels.join(", ")) } else { "0".into() },
            r.passages.to_string(),
        ]);
        t.print_rows.push(row);
    }
    t
}

// --- CSV and TSV ------------------------------------------------------------------

fn csv_cell(cell: &Cell, sep: char) -> String {
    let raw = match cell {
        Cell::Text(s) => formula_safe(s),
        other => other.display_text(),
    };
    if raw.contains(sep) || raw.contains('"') || raw.contains('\n') || raw.contains('\r') {
        format!("\"{}\"", raw.replace('"', "\"\""))
    } else {
        raw
    }
}

fn push_delimited_table(out: &mut String, t: &ReportTable, sep: char) {
    let s = sep.to_string();
    let meta = [
        vec![Cell::text("Report"), Cell::text(&t.title)],
        vec![Cell::text("Scope"), Cell::text(&t.scope_label)],
        vec![Cell::text("Source Script Version"), Cell::Int(t.source_version as i64)],
        vec![Cell::text("Planning Version"), Cell::Int(t.planning_version as i64)],
        vec![Cell::text("Summary"), Cell::text(&t.subtitle)],
        vec![Cell::text("Methodology"), Cell::text("Page and eighth lengths are estimates from the layout engine (1 page = 8 eighths).")],
    ];
    for row in &meta {
        let line: Vec<String> = row.iter().map(|c| csv_cell(c, sep)).collect();
        out.push_str(&line.join(&s));
        out.push('\n');
    }
    out.push('\n');
    let hdr: Vec<String> = t.headers.iter().map(|h| csv_cell(&Cell::text(h), sep)).collect();
    out.push_str(&hdr.join(&s));
    out.push('\n');
    for r in &t.rows {
        let line: Vec<String> = r.iter().map(|c| csv_cell(c, sep)).collect();
        out.push_str(&line.join(&s));
        out.push('\n');
    }
}

pub fn export_delimited(bundle: &ReportBundle, kind: ReportKind, sep: char) -> String {
    let mut out = String::new();
    if kind == ReportKind::All {
        for (i, t) in build_all_tables(bundle).iter().enumerate() {
            if i > 0 {
                out.push('\n');
            }
            push_delimited_table(&mut out, t, sep);
        }
    } else {
        push_delimited_table(&mut out, &build_table(bundle, kind), sep);
    }
    out
}

pub fn export_csv(bundle: &ReportBundle, kind: ReportKind) -> String {
    export_delimited(bundle, kind, ',')
}

pub fn export_tsv(bundle: &ReportBundle, kind: ReportKind) -> String {
    export_delimited(bundle, kind, '\t')
}

// --- XLSX (OpenXML workbook via zip) ----------------------------------------------

fn xml_esc(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for c in s.chars().filter(|c| printdoc::xml_safe(*c)) {
        match c {
            '&' => o.push_str("&amp;"),
            '<' => o.push_str("&lt;"),
            '>' => o.push_str("&gt;"),
            '"' => o.push_str("&quot;"),
            '\'' => o.push_str("&apos;"),
            _ => o.push(c),
        }
    }
    o
}

/// 0-based column index to Excel column letters (`A`, `B`, …, `Z`, `AA`, …).
fn col_ref(mut idx: usize) -> String {
    let mut chars = Vec::new();
    loop {
        chars.push((b'A' + (idx % 26) as u8) as char);
        if idx < 26 {
            break;
        }
        idx = idx / 26 - 1;
    }
    chars.into_iter().rev().collect()
}

fn xlsx_cell_xml(col: usize, row_1based: usize, cell: &Cell, style: u32) -> String {
    let r = format!("{}{}", col_ref(col), row_1based);
    let s_attr = if style > 0 { format!(" s=\"{style}\"") } else { String::new() };
    match cell {
        Cell::Int(n) => format!("<c r=\"{r}\"{s_attr} t=\"n\"><v>{n}</v></c>"),
        Cell::Float(f) if f.is_finite() => format!("<c r=\"{r}\"{s_attr} t=\"n\"><v>{:.1}</v></c>", (f * 10.0).round() / 10.0),
        Cell::Bool(b) => format!("<c r=\"{r}\"{s_attr} t=\"b\"><v>{}</v></c>", if *b { 1 } else { 0 }),
        _ => {
            let safe = formula_safe(&cell.display_text());
            format!("<c r=\"{r}\"{s_attr} t=\"inlineStr\"><is><t xml:space=\"preserve\">{}</t></is></c>", xml_esc(&safe))
        }
    }
}

fn worksheet_xml(t: &ReportTable) -> String {
    let mut rows_xml = String::new();
    let meta = [
        ("Report", Cell::text(&t.title)),
        ("Scope", Cell::text(&t.scope_label)),
        ("Source Script Version", Cell::Int(t.source_version as i64)),
        ("Planning Version", Cell::Int(t.planning_version as i64)),
        ("Summary", Cell::text(&t.subtitle)),
        ("Methodology", Cell::text("Page and eighth lengths are estimates from the layout engine (1 page = 8 eighths).")),
    ];
    let mut r_idx = 1usize;
    for (k, v) in &meta {
        rows_xml.push_str(&format!(
            "<row r=\"{r_idx}\">{}{}</row>",
            xlsx_cell_xml(0, r_idx, &Cell::text(*k), 1),
            xlsx_cell_xml(1, r_idx, v, 0),
        ));
        r_idx += 1;
    }
    // Blank separator row at 7; table header row at 8.
    r_idx = 8;
    let mut hdr_cells = String::new();
    for (c, h) in t.headers.iter().enumerate() {
        hdr_cells.push_str(&xlsx_cell_xml(c, r_idx, &Cell::text(h), 1));
    }
    rows_xml.push_str(&format!("<row r=\"{r_idx}\">{hdr_cells}</row>"));
    r_idx += 1;

    for row in &t.rows {
        let mut cells = String::new();
        for (c, val) in row.iter().enumerate() {
            cells.push_str(&xlsx_cell_xml(c, r_idx, val, 0));
        }
        rows_xml.push_str(&format!("<row r=\"{r_idx}\">{cells}</row>"));
        r_idx += 1;
    }

    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n\
<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">\
<sheetData>{rows_xml}</sheetData>\
</worksheet>"
    )
}

const XLSX_ROOT_RELS: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n\
<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>\
<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" Target=\"docProps/core.xml\"/>\
<Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties\" Target=\"docProps/app.xml\"/>\
</Relationships>";

const XLSX_STYLES: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n\
<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">\
<fonts count=\"2\">\
<font><sz val=\"11\"/><name val=\"Calibri\"/></font>\
<font><b/><sz val=\"11\"/><name val=\"Calibri\"/></font>\
</fonts>\
<fills count=\"2\">\
<fill><patternFill patternType=\"none\"/></fill>\
<fill><patternFill patternType=\"gray125\"/></fill>\
</fills>\
<borders count=\"1\"><border><left/><right/><top/><bottom/><diagonal/></border></borders>\
<cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>\
<cellXfs count=\"2\">\
<xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/>\
<xf numFmtId=\"0\" fontId=\"1\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\"/>\
</cellXfs>\
</styleSheet>";

const XLSX_APP: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n\
<Properties xmlns=\"http://schemas.openxmlformats.org/officeDocument/2006/extended-properties\">\
<Application>Kolbítar</Application>\
</Properties>";

pub fn export_xlsx(bundle: &ReportBundle, kind: ReportKind) -> Result<Vec<u8>, String> {
    let tables = if kind == ReportKind::All {
        build_all_tables(bundle)
    } else {
        vec![build_table(bundle, kind)]
    };

    let mut content_types = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n\
<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">\
<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>\
<Default Extension=\"xml\" ContentType=\"application/xml\"/>\
<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>\
<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>\
<Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/>\
<Override PartName=\"/docProps/app.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.extended-properties+xml\"/>",
    );
    let mut wb_sheets = String::new();
    let mut wb_rels = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n\
<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
<Relationship Id=\"rIdStyles\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>",
    );

    let mut sheet_files: Vec<(String, String)> = Vec::with_capacity(tables.len());
    for (i, t) in tables.iter().enumerate() {
        let num = i + 1;
        content_types.push_str(&format!(
            "<Override PartName=\"/xl/worksheets/sheet{num}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>"
        ));
        wb_sheets.push_str(&format!(
            "<sheet name=\"{}\" sheetId=\"{num}\" r:id=\"rIdSheet{num}\"/>",
            xml_esc(t.kind.sheet_name())
        ));
        wb_rels.push_str(&format!(
            "<Relationship Id=\"rIdSheet{num}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet{num}.xml\"/>"
        ));
        sheet_files.push((format!("xl/worksheets/sheet{num}.xml"), worksheet_xml(t)));
    }
    content_types.push_str("</Types>");
    wb_rels.push_str("</Relationships>");

    let workbook_xml = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n\
<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">\
<sheets>{wb_sheets}</sheets>\
</workbook>"
    );
    let core_xml = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n\
<cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\">\
<dc:title>{}</dc:title><dc:creator>Kolbítar</dc:creator><dc:description>{}</dc:description>\
</cp:coreProperties>",
        xml_esc(kind.title()),
        xml_esc(&format!("{} · v{}", bundle.scope_label, bundle.source_version))
    );

    let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let fixed = zip::DateTime::from_date_and_time(2000, 1, 1, 0, 0, 0).map_err(|e| e.to_string())?;
    let opts = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .last_modified_time(fixed)
        .system(zip::System::Unix)
        .external_attributes(0o100644 << 16);

    let mut parts: Vec<(String, String)> = vec![
        ("[Content_Types].xml".into(), content_types),
        ("_rels/.rels".into(), XLSX_ROOT_RELS.into()),
        ("xl/workbook.xml".into(), workbook_xml),
        ("xl/_rels/workbook.xml.rels".into(), wb_rels),
        ("xl/styles.xml".into(), XLSX_STYLES.into()),
    ];
    parts.extend(sheet_files);
    parts.push(("docProps/core.xml".into(), core_xml));
    parts.push(("docProps/app.xml".into(), XLSX_APP.into()));

    for (name, xml) in &parts {
        zip.start_file(name, opts).map_err(|e| e.to_string())?;
        zip.write_all(xml.as_bytes()).map_err(|e| e.to_string())?;
    }
    Ok(zip.finish().map_err(|e| e.to_string())?.into_inner())
}

// --- HTML -------------------------------------------------------------------------

fn html_esc(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for c in s.chars().filter(|c| printdoc::xml_safe(*c)) {
        match c {
            '&' => o.push_str("&amp;"),
            '<' => o.push_str("&lt;"),
            '>' => o.push_str("&gt;"),
            '"' => o.push_str("&quot;"),
            '\'' => o.push_str("&#39;"),
            _ => o.push(c),
        }
    }
    o
}

pub fn export_html(bundle: &ReportBundle, kind: ReportKind) -> String {
    let tables = if kind == ReportKind::All {
        build_all_tables(bundle)
    } else {
        vec![build_table(bundle, kind)]
    };
    let doc_title = format!("{} — {}", kind.title(), bundle.scope_label);
    let mut out = format!(
        "<!DOCTYPE html>\n\
<html lang=\"en\">\n\
<head>\n\
<meta charset=\"utf-8\">\n\
<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n\
<meta name=\"generator\" content=\"Kolbítar\">\n\
<title>{}</title>\n\
<style>\n\
@page {{ size: letter; margin: 0.75in; }}\n\
body {{ font-family: \"Courier Prime\", \"Courier New\", Courier, monospace; font-size: 11pt; line-height: 1.4; color: #111; background: #fff; margin: 0.75in auto; max-width: 9.5in; padding: 0 0.5in; }}\n\
@media print {{ body {{ margin: 0; padding: 0; max-width: none; }} section.report-section + section.report-section {{ break-before: page; }} }}\n\
h1 {{ font-size: 15pt; margin: 0 0 4pt 0; }}\n\
h2 {{ font-size: 13pt; margin: 18pt 0 4pt 0; }}\n\
.meta {{ font-size: 10pt; color: #333; margin: 0 0 12pt 0; }}\n\
table {{ width: 100%; border-collapse: collapse; margin: 8pt 0 18pt 0; font-size: 10pt; }}\n\
th, td {{ border: 1px solid #444; padding: 4pt 6pt; text-align: left; vertical-align: top; overflow-wrap: anywhere; }}\n\
th {{ background: #eee; font-weight: bold; }}\n\
thead {{ display: table-header-group; }}\n\
tr {{ break-inside: avoid; }}\n\
</style>\n\
</head>\n\
<body>\n\
<header>\n\
<h1>{}</h1>\n\
<p class=\"meta\">Scope: {} · Source script v{} · Planning v{} · {} page{} · Scenes sum to ≈ {} pages (estimate). Page and eighth lengths are estimates from the layout.</p>\n\
</header>\n\
<main>\n",
        html_esc(&doc_title),
        html_esc(kind.title()),
        html_esc(&bundle.scope_label),
        bundle.source_version,
        bundle.planning_version,
        bundle.total_pages,
        if bundle.total_pages == 1 { "" } else { "s" },
        html_esc(&fmt_eighths(bundle.total_eighths)),
    );

    for t in &tables {
        out.push_str("<section class=\"report-section\">\n");
        if tables.len() > 1 {
            out.push_str(&format!("<h2>{}</h2>\n", html_esc(&t.title)));
        }
        out.push_str(&format!("<p class=\"meta\">{}</p>\n", html_esc(&t.subtitle)));
        out.push_str("<table>\n<thead>\n<tr>");
        for h in &t.print_headers {
            out.push_str(&format!("<th scope=\"col\">{}</th>", html_esc(h)));
        }
        out.push_str("</tr>\n</thead>\n<tbody>\n");
        if t.print_rows.is_empty() {
            out.push_str(&format!(
                "<tr><td colspan=\"{}\">No rows in the selected scope.</td></tr>\n",
                t.print_headers.len().max(1)
            ));
        } else {
            for r in &t.print_rows {
                out.push_str("<tr>");
                for c in r {
                    out.push_str(&format!("<td>{}</td>", html_esc(c)));
                }
                out.push_str("</tr>\n");
            }
        }
        out.push_str("</tbody>\n</table>\n</section>\n");
    }

    out.push_str("</main>\n</body>\n</html>\n");
    out
}

// --- RTF --------------------------------------------------------------------------

fn rtf_esc(s: &str) -> String {
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

pub fn export_rtf(bundle: &ReportBundle, kind: ReportKind) -> String {
    let tables = if kind == ReportKind::All {
        build_all_tables(bundle)
    } else {
        vec![build_table(bundle, kind)]
    };
    let mut s = String::from(
        "{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1\n\
{\\fonttbl{\\f0\\fmodern\\fcharset0 Courier Prime;}}\n",
    );
    s.push_str(&format!(
        "{{\\info{{\\title {}}}{{\\author Kolb\\u237?tar}}}}\n\
\\paperw12240\\paperh15840\\margl1080\\margr1080\\margt1080\\margb1080\\widowctrl\n",
        rtf_esc(kind.title()),
    ));
    s.push_str(&format!(
        "\\pard\\plain\\sb0\\sa120\\f0\\fs28\\b {}\\b0\\par\n\
\\pard\\plain\\sb0\\sa180\\f0\\fs20 {}\\par\n",
        rtf_esc(kind.title()),
        rtf_esc(&format!(
            "Scope: {} | Source script v{} | Planning v{} | {} page{} | Scenes sum to ~{} pages (estimate). Page and eighth lengths are estimates from the layout.",
            bundle.scope_label,
            bundle.source_version,
            bundle.planning_version,
            bundle.total_pages,
            if bundle.total_pages == 1 { "" } else { "s" },
            fmt_eighths(bundle.total_eighths),
        )),
    ));

    // Printable width between 0.75 in margins on US Letter is 7.0 in = 10080 twips.
    let total_twips = 10080usize;
    for (ti, t) in tables.iter().enumerate() {
        if ti > 0 {
            s.push_str("\\pard\\plain\\pagebb\\sb240\\sa80\\f0\\fs24\\b ");
            s.push_str(&rtf_esc(&t.title));
            s.push_str("\\b0\\par\n");
        }
        s.push_str(&format!(
            "\\pard\\plain\\sb60\\sa120\\f0\\fs20 {}\\par\n",
            rtf_esc(&t.subtitle)
        ));
        let ncols = t.print_headers.len().max(1);
        let row_def = {
            let mut d = String::from("\\trowd\\trgaph108\\trleft0");
            for c in 1..=ncols {
                let right = (total_twips * c) / ncols;
                d.push_str(&format!(
                    "\\clbrdrt\\brdrs\\brdrw10\\clbrdrl\\brdrs\\brdrw10\\clbrdrb\\brdrs\\brdrw10\\clbrdrr\\brdrs\\brdrw10\\cellx{right}"
                ));
            }
            d
        };
        // Header row.
        s.push_str(&row_def);
        s.push('\n');
        for h in &t.print_headers {
            s.push_str(&format!("\\pard\\intbl\\f0\\fs18\\b {}\\b0\\cell\n", rtf_esc(h)));
        }
        s.push_str("\\row\n");
        // Data rows.
        for r in &t.print_rows {
            s.push_str(&row_def);
            s.push('\n');
            for c in r {
                s.push_str(&format!("\\pard\\intbl\\f0\\fs18 {}\\cell\n", rtf_esc(c)));
            }
            s.push_str("\\row\n");
        }
        s.push_str("\\pard\\plain\\sb120\\f0\\fs20\\par\n");
    }
    s.push_str("}\n");
    s
}

// --- PDF (paginated via cirth_core::pdf) ------------------------------------------

fn plain_pline(row: usize, x_in: f32, text: String, bold: bool) -> PLine {
    PLine {
        row,
        x_in,
        segs: vec![Seg { text, bold, italic: false, underline: false }],
        block_id: None,
        kind: "action",
        start: 0,
        end: 0,
        synthetic: false,
    }
}

/// Choose column widths (in characters summing to `total_cols` minus gaps)
/// and wrap each row's cells so no text is ever clipped horizontally (E9).
fn format_wrapped_rows(headers: &[String], rows: &[Vec<String>], total_cols: usize) -> (Vec<String>, Vec<Vec<String>>) {
    let n = headers.len();
    if n == 0 {
        return (Vec::new(), Vec::new());
    }
    let gaps = (n - 1) * 2;
    let avail = total_cols.saturating_sub(gaps).max(n * 4);
    // Natural max width per column (capped so one long column doesn't starve the rest).
    let mut max_w: Vec<usize> = headers
        .iter()
        .enumerate()
        .map(|(i, h)| {
            let cell_max = rows.iter().filter_map(|r| r.get(i)).map(|c| c.chars().count()).max().unwrap_or(0);
            h.chars().count().max(cell_max).clamp(4, 32)
        })
        .collect();
    let sum_max: usize = max_w.iter().sum();
    if sum_max > avail {
        let mut widths: Vec<usize> = max_w.iter().map(|&w| ((w * avail) / sum_max).max(4)).collect();
        while widths.iter().sum::<usize>() > avail {
            if let Some((idx, _)) = widths.iter().enumerate().max_by_key(|&(_, &w)| w) {
                if widths[idx] > 4 {
                    widths[idx] -= 1;
                } else {
                    break;
                }
            }
        }
        max_w = widths;
    }

    let wrap_row = |cells: &[String]| -> Vec<String> {
        let wrapped_cols: Vec<Vec<String>> = (0..n)
            .map(|i| {
                let s = cells.get(i).map(String::as_str).unwrap_or("");
                let w = max_w[i];
                if s.is_empty() {
                    vec![String::new()]
                } else {
                    layout::wrap(s, w)
                        .into_iter()
                        .map(|(a, b)| s.chars().skip(a).take(b.saturating_sub(a)).collect::<String>())
                        .collect()
                }
            })
            .collect();
        let height = wrapped_cols.iter().map(|c| c.len()).max().unwrap_or(1).max(1);
        let mut lines = Vec::with_capacity(height);
        for line_i in 0..height {
            let mut line = String::new();
            for col_i in 0..n {
                if col_i > 0 {
                    line.push_str("  ");
                }
                let part = wrapped_cols[col_i].get(line_i).map(String::as_str).unwrap_or("");
                let pad = max_w[col_i].saturating_sub(part.chars().count());
                line.push_str(part);
                if col_i + 1 < n {
                    for _ in 0..pad {
                        line.push(' ');
                    }
                }
            }
            lines.push(line);
        }
        lines
    };

    let hdr_lines = wrap_row(headers);
    let mut sep = String::new();
    for (i, &w) in max_w.iter().enumerate() {
        if i > 0 {
            sep.push_str("  ");
        }
        for _ in 0..w {
            sep.push('-');
        }
    }
    let mut header_block = hdr_lines;
    header_block.push(sep);

    let body_blocks: Vec<Vec<String>> = rows.iter().map(|r| wrap_row(r)).collect();
    (header_block, body_blocks)
}

pub fn export_pdf(
    bundle: &ReportBundle,
    kind: ReportKind,
    p: &Profile,
    date_unix: i64,
    document_id: &str,
) -> Result<Vec<u8>, String> {
    let tables = if kind == ReportKind::All {
        build_all_tables(bundle)
    } else {
        vec![build_table(bundle, kind)]
    };

    let x_in = 1.0_f32;
    let total_cols = ((p.page_w_in - 2.0) * p.chars_per_inch).floor() as usize;
    let body_lines = p.body_lines();

    let mut pages: Vec<Page> = Vec::new();
    let mut cur_lines: Vec<PLine> = Vec::new();
    let mut row_idx = 0usize;

    let flush_page = |pages: &mut Vec<Page>, cur_lines: &mut Vec<PLine>, row_idx: &mut usize| {
        if !cur_lines.is_empty() {
            let num = pages.len() + 1;
            pages.push(Page {
                number: num,
                label: num.to_string(),
                lines: std::mem::take(cur_lines),
                revised: false,
            });
            *row_idx = 0;
        }
    };

    // Report header on page 1.
    cur_lines.push(plain_pline(row_idx, x_in, kind.title().to_uppercase(), true));
    row_idx += 1;
    let meta = format!(
        "Scope: {} · v{} (planning v{}) · {} page{} · ≈ {} p (estimate)",
        bundle.scope_label,
        bundle.source_version,
        bundle.planning_version,
        bundle.total_pages,
        if bundle.total_pages == 1 { "" } else { "s" },
        fmt_eighths(bundle.total_eighths),
    );
    for (a, b) in layout::wrap(&meta, total_cols) {
        cur_lines.push(plain_pline(row_idx, x_in, meta.chars().skip(a).take(b.saturating_sub(a)).collect(), false));
        row_idx += 1;
    }
    cur_lines.push(plain_pline(
        row_idx,
        x_in,
        "Page and eighth lengths are estimates from the layout.".into(),
        false,
    ));
    row_idx += 2;

    for (ti, t) in tables.iter().enumerate() {
        let (hdr_block, row_blocks) = format_wrapped_rows(&t.print_headers, &t.print_rows, total_cols);
        let needed_for_start = 2 + hdr_block.len() + row_blocks.first().map(|r| r.len()).unwrap_or(1);
        if ti > 0 && row_idx + needed_for_start > body_lines {
            flush_page(&mut pages, &mut cur_lines, &mut row_idx);
        } else if ti > 0 {
            row_idx += 1;
        }

        if tables.len() > 1 {
            cur_lines.push(plain_pline(row_idx, x_in, t.title.to_uppercase(), true));
            row_idx += 1;
        }
        for (a, b) in layout::wrap(&t.subtitle, total_cols) {
            cur_lines.push(plain_pline(row_idx, x_in, t.subtitle.chars().skip(a).take(b.saturating_sub(a)).collect(), false));
            row_idx += 1;
        }
        row_idx += 1;

        for (hi, hl) in hdr_block.iter().enumerate() {
            cur_lines.push(plain_pline(row_idx, x_in, hl.clone(), hi + 1 < hdr_block.len()));
            row_idx += 1;
        }

        if row_blocks.is_empty() {
            cur_lines.push(plain_pline(row_idx, x_in, "(No rows in the selected scope.)".into(), false));
            row_idx += 1;
        } else {
            for rb in &row_blocks {
                // Keep a multi-line table row together on one page, and repeat table headers on a new page (E9).
                if row_idx + rb.len() > body_lines && !cur_lines.is_empty() {
                    flush_page(&mut pages, &mut cur_lines, &mut row_idx);
                    for (hi, hl) in hdr_block.iter().enumerate() {
                        if row_idx < body_lines {
                            cur_lines.push(plain_pline(row_idx, x_in, hl.clone(), hi + 1 < hdr_block.len()));
                            row_idx += 1;
                        }
                    }
                }
                for line in rb {
                    if row_idx >= body_lines {
                        flush_page(&mut pages, &mut cur_lines, &mut row_idx);
                    }
                    cur_lines.push(plain_pline(row_idx, x_in, line.clone(), false));
                    row_idx += 1;
                }
            }
        }
    }
    flush_page(&mut pages, &mut cur_lines, &mut row_idx);

    let map = PageMap {
        profile: p.name,
        engine: layout::ENGINE_VERSION,
        doc_version: bundle.source_version,
        body_lines,
        pages,
        page_starts: Vec::new(),
        warnings: Vec::new(),
    };
    let opts = PdfOptions {
        title: format!("{} ({})", kind.title(), bundle.scope_label),
        author: "Kolbítar".into(),
        subject: format!("{} · v{}", bundle.scope_label, bundle.source_version),
        date_unix,
        document_id: format!("report-{}-{document_id}", kind.id()),
        header: format!("{} · {} · v{}", kind.title(), bundle.scope_label, bundle.source_version),
        footer: "Page and eighth lengths are estimates.".into(),
        revision_header: String::new(),
    };
    pdf::render_document(&map, p, None, &opts)
}

pub struct ReportExportOut {
    pub bytes: Vec<u8>,
    pub notes: Vec<String>,
}

/// Export `kind` from `bundle` in `format`, returning the file bytes and a
/// summary of what was written (scope, source version, estimate notes and
/// format capabilities).
pub fn export(
    bundle: &ReportBundle,
    kind: ReportKind,
    format: ReportFormat,
    p: &Profile,
    date_unix: i64,
    document_id: &str,
) -> Result<ReportExportOut, String> {
    let mut notes = vec![
        format!(
            "Scope: {} (script v{}, planning v{}).",
            bundle.scope_label, bundle.source_version, bundle.planning_version
        ),
        "Page and eighth lengths are estimates from the layout.".into(),
    ];
    let bytes = match format {
        ReportFormat::Csv => {
            notes.push("UTF-8 CSV with human-readable scene numbers, stable source IDs and formula-safe text cells.".into());
            export_csv(bundle, kind).into_bytes()
        }
        ReportFormat::Tsv => {
            notes.push("UTF-8 TSV with human-readable scene numbers, stable source IDs and formula-safe text cells.".into());
            export_tsv(bundle, kind).into_bytes()
        }
        ReportFormat::Xlsx => {
            if kind == ReportKind::All {
                notes.push("7 worksheets written (Scenes, Characters, Locations, Action vs Dialogue, Interior vs Exterior, Day vs Night, Revisions) with typed numeric columns.".into());
            } else {
                notes.push(format!("Worksheet \"{}\" written with typed numeric columns and stable source IDs.", kind.sheet_name()));
            }
            export_xlsx(bundle, kind)?
        }
        ReportFormat::Html => {
            notes.push("Self-contained HTML report with scope, version stamp and formatted report tables.".into());
            export_html(bundle, kind).into_bytes()
        }
        ReportFormat::Pdf => {
            notes.push("Paginated PDF in Courier Prime 12 pt with wrapped columns and repeated table headers on page breaks.".into());
            export_pdf(bundle, kind, p, date_unix, document_id)?
        }
        ReportFormat::Rtf => {
            notes.push("Rich Text report with scope, version stamp and bordered report tables.".into());
            export_rtf(bundle, kind).into_bytes()
        }
    };
    Ok(ReportExportOut { bytes, notes })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bible::Entity;
    use crate::model::{Beat, Block, BlockKind, Run};
    use crate::numbering::{Numbers, SceneNumber};
    use crate::reports::{compute, DocInput, ReportScope, ScopeDoc};
    use crate::revisions::RevisionSet;
    use std::io::Read;

    fn sample_bundle() -> ReportBundle {
        let mut s1 = Block::new(BlockKind::Heading, "INT. COUNTING HOUSE - NIGHT");
        s1.id = "b_s1".into();
        let s1_id = s1.scene_id.clone().unwrap();

        let mut s2 = Block::new(BlockKind::Heading, "EXT. HARBOUR WALL - DAY");
        s2.id = "b_s2".into();
        let s2_id = s2.scene_id.clone().unwrap();

        let mut act = Block::new(BlockKind::Action, "");
        act.runs = vec![Run { revision: Some("r1".into()), ..Run::plain("=SUM(1,2) formula-like action text.") }];

        let blocks = vec![
            s1,
            act,
            Block::new(BlockKind::Character, "INES"),
            Block::new(BlockKind::Dialogue, "Count it again."),
            s2,
            Block::new(BlockKind::Action, "Waves strike the stones."),
            Block::new(BlockKind::Character, "PELL"),
            Block::new(BlockKind::Dialogue, "It matches."),
        ];

        let mut numbers = Numbers::new();
        numbers.insert(s1_id.clone(), SceneNumber { scene_id: s1_id.clone(), number: "1".into(), omitted: false });
        numbers.insert(s2_id.clone(), SceneNumber { scene_id: s2_id.clone(), number: "2".into(), omitted: false });

        let beat = Beat {
            id: "beat_1".into(),
            logline: "=1+1 dangerous logline, with \"quotes\"".into(),
            summary: String::new(),
            scene_id: Some(s1_id),
            pos: 1.0,
            kind: "beat".into(),
            title: String::new(),
            parent: None,
        };

        let rev = RevisionSet {
            id: "r1".into(),
            label: "Blue Revision".into(),
            colour: "blue".into(),
            date: "2026-10-28".into(),
            mark: "*".into(),
            author: "J.H.".into(),
        };

        let doc = DocInput {
            id: "doc_main".into(),
            title: "The Tide Ledger".into(),
            profile: Profile::us_letter(),
            blocks,
            beats: vec![beat],
            numbers,
            page_lock: None,
            revision_sets: vec![rev],
            active_revision: Some("r1".into()),
        };

        compute(
            &[doc],
            vec![ScopeDoc { id: "doc_main".into(), title: "The Tide Ledger".into() }],
            &[Entity::default()],
            ReportScope { mode: "document".into(), documents: vec!["doc_main".into()], include_omitted: false },
            9,
            3,
        )
    }

    #[test]
    fn csv_and_tsv_quote_escape_formulas_and_stamp_scope_and_version() {
        let bundle = sample_bundle();
        let csv = export_csv(&bundle, ReportKind::Scenes);
        assert!(csv.contains("Report,Scenes Report"));
        assert!(csv.contains("Scope,This script: The Tide Ledger"));
        assert!(csv.contains("Source Script Version,9"));
        // Leading `=` in the beat logline is neutralized with `'=` and quotes are doubled.
        assert!(csv.contains("\"'=1+1 dangerous logline, with \"\"quotes\"\"\""), "formula-safe quoted cell in CSV: {csv}");
        assert!(csv.contains("doc_main"), "stable document ID included");

        let tsv = export_tsv(&bundle, ReportKind::Characters);
        assert!(tsv.contains("Report\tCharacters Report"));
        assert!(tsv.contains("INES\t1\t0\t3\t60.0\t1"));
    }

    #[test]
    fn xlsx_writes_well_formed_xml_typed_numbers_and_repeatable_bytes() {
        let bundle = sample_bundle();
        let a = export_xlsx(&bundle, ReportKind::All).unwrap();
        let b = export_xlsx(&bundle, ReportKind::All).unwrap();
        assert_eq!(a, b, "byte-identical across runs");

        let mut z = zip::ZipArchive::new(std::io::Cursor::new(&a)).unwrap();
        assert_eq!(z.len(), 14, "7 worksheets + 7 package parts");
        for i in 0..z.len() {
            let mut f = z.by_index(i).unwrap();
            let mut xml = String::new();
            f.read_to_string(&mut xml).unwrap();
            let mut r = quick_xml::Reader::from_str(&xml);
            loop {
                match r.read_event() {
                    Ok(quick_xml::events::Event::Eof) => break,
                    Err(e) => panic!("part {i} is not well-formed XML: {e}"),
                    _ => {}
                }
            }
        }
        let mut sheet1 = String::new();
        z.by_name("xl/worksheets/sheet1.xml").unwrap().read_to_string(&mut sheet1).unwrap();
        // Version 9 and eighths are written as typed numbers (`t="n"`).
        assert!(sheet1.contains("t=\"n\"><v>9</v>"), "version as number: {sheet1}");
        assert!(sheet1.contains("t=\"b\"><v>0</v>"), "omitted boolean as typed bool: {sheet1}");
        assert!(sheet1.contains("&apos;=1+1 dangerous logline"), "formula injection neutralized in XLSX");
    }

    #[test]
    fn html_rtf_and_pdf_exports_carry_scope_version_and_all_rows() {
        let bundle = sample_bundle();
        let html = export_html(&bundle, ReportKind::Locations);
        assert!(html.starts_with("<!DOCTYPE html>"));
        assert!(html.contains("Locations Report"));
        assert!(html.contains("Source script v9"));
        assert!(html.contains("COUNTING HOUSE") && html.contains("HARBOUR WALL"));
        assert!(!html.contains("<script"));

        let rtf = export_rtf(&bundle, ReportKind::Revisions);
        assert!(rtf.starts_with("{\\rtf1"));
        assert!(rtf.contains("Revisions Report"));
        assert!(rtf.contains("Blue Revision (active)"));
        assert!(rtf.contains("\\trowd"));

        let pdf = export_pdf(&bundle, ReportKind::All, &Profile::us_letter(), 1_767_225_600, "test-doc").unwrap();
        let pdf_again = export_pdf(&bundle, ReportKind::All, &Profile::us_letter(), 1_767_225_600, "test-doc").unwrap();
        assert_eq!(pdf, pdf_again, "PDF bytes are deterministic");
        assert!(pdf.starts_with(b"%PDF-"));
    }
}
