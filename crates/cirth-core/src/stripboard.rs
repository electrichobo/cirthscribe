//! Stripboard and shooting schedule engine (M4 step 5, acceptance E3, E4, E9).
//!
//! Generates a vertical stack of scene strips from the script with its own
//! independent schedule order. Dragging or reordering strips changes schedule
//! order only and never alters screenplay text or script order (E3).
//! Script edits refresh strip fields while preserving scheduling choices and
//! user notes (E3). Omitted and deleted scenes remain in the schedule visibly
//! flagged rather than silently erased (E4).
//! Exports to PDF and HTML without clipped text (E9), XLSX and CSV.

use std::collections::HashMap;
use std::io::{Cursor, Write};
use serde::{Deserialize, Serialize};

use crate::layout::{self, Page, PageMap, PLine, Profile, Seg};
use crate::model::BlockKind;
use crate::pdf::{self, PdfOptions};
use crate::report_export::fmt_eighths;
use crate::reports::{self, ReportScope, SceneRow};
use crate::store::{Result, Store};
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

/// The kind of strip in the schedule.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StripKind {
    Scene,
    DayBreak,
    Banner,
}

/// Standard stripboard color definitions pairing color with distinct symbols
/// and names so color is never the only signal (E3, E9).
pub const COLOR_DAY_INT: (&str, &str, &str, &str) = ("day_int", "Day Interior", "○", "#FFF9DB");
pub const COLOR_NIGHT_INT: (&str, &str, &str, &str) = ("night_int", "Night Interior", "●", "#D0EBFF");
pub const COLOR_DAY_EXT: (&str, &str, &str, &str) = ("day_ext", "Day Exterior", "☼", "#FFE8CC");
pub const COLOR_NIGHT_EXT: (&str, &str, &str, &str) = ("night_ext", "Night Exterior", "☽", "#D3F9D8");
pub const COLOR_OTHER: (&str, &str, &str, &str) = ("other", "Other / Mixed", "◈", "#E5DBFF");

/// Compute color code, readable label, symbol, and hex color from scene INT/EXT and time of day.
pub fn color_code_for(int_ext: &str, time_of_day: &str) -> (&'static str, &'static str, &'static str, &'static str) {
    let ie = int_ext.to_uppercase();
    let tod = time_of_day.to_uppercase();
    let is_night = tod.contains("NIGHT") || tod.contains("EVENING") || tod.contains("LATE") || tod.contains("MIDNIGHT");

    if ie.starts_with("INT") && !ie.contains("EXT") {
        if is_night {
            COLOR_NIGHT_INT
        } else {
            COLOR_DAY_INT
        }
    } else if ie.starts_with("EXT") && !ie.contains("INT") {
        if is_night {
            COLOR_NIGHT_EXT
        } else {
            COLOR_DAY_EXT
        }
    } else {
        COLOR_OTHER
    }
}

/// One strip on the stripboard.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Strip {
    /// Stable strip identifier (for scene strips, usually `strip_<scene_id>`).
    pub id: String,
    pub kind: StripKind,
    #[serde(default)]
    pub document_id: String,
    #[serde(default)]
    pub document_title: String,
    #[serde(default)]
    pub scene_id: Option<String>,
    #[serde(default)]
    pub scene_number: String,
    #[serde(default)]
    pub heading: String,
    #[serde(default)]
    pub int_ext: String,
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub time_of_day: String,
    /// Beat card logline/summary or first action block text. Full text, never clipped in exports (E9).
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub page: String,
    /// Length in eighths of a page (estimate).
    #[serde(default)]
    pub eighths: u32,
    /// Speaking cast plus silent cast from breakdown tags, alias-resolved.
    #[serde(default)]
    pub characters: Vec<String>,
    /// Breakdown tags configured for this scene (e.g. "PROP: Ledger").
    #[serde(default)]
    pub tags: Vec<String>,
    /// User-authored scheduling notes (e.g. "Needs crane", "Shoot before lunch").
    #[serde(default)]
    pub note: String,
    /// True if scene was omitted in the script (E4).
    #[serde(default)]
    pub omitted: bool,
    /// True if scene was deleted from the screenplay text (E4).
    #[serde(default)]
    pub deleted: bool,
    #[serde(default)]
    pub color_code: String,
    #[serde(default)]
    pub color_label: String,
    #[serde(default)]
    pub color_symbol: String,

    // DayBreak fields
    #[serde(default)]
    pub day_number: Option<u32>,
    #[serde(default)]
    pub day_title: Option<String>,
    #[serde(default)]
    pub total_eighths: Option<u32>,
    #[serde(default)]
    pub total_scenes: Option<usize>,

    // Banner fields
    #[serde(default)]
    pub banner_text: Option<String>,
}

impl Strip {
    /// Format length in eighths as standard fractional pages (e.g. "2 3/8", "4/8").
    pub fn fmt_pages(&self) -> String {
        let whole = self.eighths / 8;
        let rem = self.eighths % 8;
        match (whole, rem) {
            (0, 0) => "0 pgs".into(),
            (0, r) => format!("{r}/8 pgs"),
            (w, 0) => format!("{w} pg{}", if w == 1 { "" } else { "s" }),
            (w, r) => format!("{w} {r}/8 pgs"),
        }
    }
}

/// The entire schedule state for a scope.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct ScheduleState {
    pub scope: String,
    pub scope_label: String,
    pub scheduled: Vec<Strip>,
    pub unscheduled: Vec<Strip>,
    pub source_version: u64,
    pub planning_version: u64,
    pub total_scheduled_scenes: usize,
    pub total_scheduled_eighths: u32,
    pub total_shooting_days: u32,
}

/// Recalculate sequential day numbers and aggregated day metrics for scheduled strips.
pub fn recalculate_day_breaks(scheduled: &mut [Strip]) {
    let mut current_day = 0u32;
    let mut day_break_indices: Vec<usize> = Vec::new();

    for (i, strip) in scheduled.iter_mut().enumerate() {
        if strip.kind == StripKind::DayBreak {
            current_day += 1;
            strip.day_number = Some(current_day);
            if strip.day_title.as_deref().unwrap_or("").trim().is_empty() {
                strip.day_title = Some(format!("Day {current_day}"));
            }
            day_break_indices.push(i);
        }
    }

    // Now aggregate scenes and eighths for each day break.
    for (idx_pos, &break_idx) in day_break_indices.iter().enumerate() {
        let next_break = day_break_indices.get(idx_pos + 1).copied().unwrap_or(scheduled.len());
        let mut count = 0usize;
        let mut eighths = 0u32;

        for s in &scheduled[break_idx + 1..next_break] {
            if s.kind == StripKind::Scene {
                count += 1;
                eighths += s.eighths;
            }
        }

        scheduled[break_idx].total_scenes = Some(count);
        scheduled[break_idx].total_eighths = Some(eighths);
    }
}

/// Helper to get the first action text of each scene in a document as a description fallback.
fn scene_action_snippets(doc_blocks: &[crate::model::Block]) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let mut current_scene: Option<String> = None;
    let mut current_has_action = false;

    for b in doc_blocks {
        if b.kind == BlockKind::Heading {
            current_scene = Some(b.id.clone());
            current_has_action = false;
        } else if b.kind == BlockKind::Action && current_scene.is_some() && !current_has_action {
            let text: String = b.runs.iter().map(|r| r.text.as_str()).collect();
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                if let Some(sid) = &current_scene {
                    out.insert(sid.clone(), trimmed.to_string());
                    current_has_action = true;
                }
            }
        }
    }
    out
}

/// Create a Strip from a live `SceneRow` and its associated tags and fallback snippets.
fn make_scene_strip(
    row: &SceneRow,
    snippets: &HashMap<String, String>,
    tags_by_scene: &HashMap<String, Vec<String>>,
) -> Strip {
    let (code, label, sym, _) = color_code_for(&row.int_ext, &row.time_of_day);
    let desc = if !row.logline.trim().is_empty() {
        row.logline.trim().to_string()
    } else if let Some(snippet) = snippets.get(&row.scene_id) {
        snippet.clone()
    } else {
        row.heading.clone()
    };

    let tags = tags_by_scene.get(&row.scene_id).cloned().unwrap_or_default();

    Strip {
        id: format!("strip_{}", row.scene_id),
        kind: StripKind::Scene,
        document_id: row.document_id.clone(),
        document_title: row.document_title.clone(),
        scene_id: Some(row.scene_id.clone()),
        scene_number: row.number.clone(),
        heading: row.heading.clone(),
        int_ext: row.int_ext.clone(),
        location: row.location.clone(),
        time_of_day: row.time_of_day.clone(),
        description: desc,
        page: row.page.clone(),
        eighths: row.eighths,
        characters: row.speakers.clone(),
        tags,
        note: String::new(),
        omitted: row.omitted,
        deleted: false,
        color_code: code.into(),
        color_label: label.into(),
        color_symbol: sym.into(),
        day_number: None,
        day_title: None,
        total_eighths: None,
        total_scenes: None,
        banner_text: None,
    }
}

/// Load and reconcile the stripboard schedule with the live screenplay (E3, E4).
///
/// If no schedule exists yet, a default schedule is initialized with Day 1 and all
/// scenes in current script order.
/// If a schedule exists, scheduled strip order is preserved independently of any
/// script edits (E3). Live fields (numbers, eighths, headings, speakers, tags) refresh
/// from the updated screenplay (E3). Omitted or deleted scenes remain in the schedule
/// flagged visibly rather than silently erased (E4).
pub fn reconcile_schedule(store: &Store, scope: &ReportScope) -> Result<ScheduleState> {
    // Generate full report bundle across scope including omitted scenes so their metrics exist.
    let mut report_scope = scope.clone();
    report_scope.include_omitted = true;
    let bundle = reports::from_store(store, &report_scope)?;
    let scope_key = match scope.mode.as_str() {
        "project" => "project".to_string(),
        "episodes" => format!("episodes:{}", scope.documents.join(",")),
        _ => format!("document:{}", scope.documents.first().map(|s| s.as_str()).unwrap_or("")),
    };

    // Collect first action snippets for fallback descriptions and map tags to scenes.
    let mut snippets: HashMap<String, String> = HashMap::new();
    let mut tags_by_scene: HashMap<String, Vec<String>> = HashMap::new();

    let docs = store.documents()?;
    let all_tags = store.tags()?;

    for (doc_id, _title) in docs {
        let doc = store.load_document(&doc_id)?;
        let doc_snippets = scene_action_snippets(&doc.blocks);
        snippets.extend(doc_snippets);

        // Map blocks to scenes for tags.
        let mut block_to_scene: HashMap<String, String> = HashMap::new();
        let mut cur_scene = String::new();
        for b in &doc.blocks {
            if b.kind == BlockKind::Heading {
                cur_scene = b.id.clone();
            }
            if !cur_scene.is_empty() {
                block_to_scene.insert(b.id.clone(), cur_scene.clone());
            }
        }

        for t in &all_tags {
            if t.document_id == doc_id {
                if let Some(sid) = block_to_scene.get(&t.block_id) {
                    let tag_str = format!("{}: {}", t.category.to_uppercase(), t.quote.trim());
                    let entry = tags_by_scene.entry(sid.clone()).or_default();
                    if !entry.contains(&tag_str) {
                        entry.push(tag_str);
                    }
                }
            }
        }
    }

    let live_scenes: HashMap<&str, &SceneRow> = bundle.scenes.iter().map(|s| (s.scene_id.as_str(), s)).collect();
    let stored_schedule = store.schedule(&scope_key)?;

    let mut scheduled: Vec<Strip> = Vec::new();
    let mut unscheduled: Vec<Strip> = Vec::new();

    let has_stored = stored_schedule.as_ref().is_some_and(|st| !st.scheduled.is_empty() || !st.unscheduled.is_empty());

    if !has_stored {
        // Default initialization: Day 1 break followed by all live scenes in script order.
        scheduled.push(Strip {
            id: "day_break_1".into(),
            kind: StripKind::DayBreak,
            document_id: String::new(),
            document_title: String::new(),
            scene_id: None,
            scene_number: String::new(),
            heading: String::new(),
            int_ext: String::new(),
            location: String::new(),
            time_of_day: String::new(),
            description: String::new(),
            page: String::new(),
            eighths: 0,
            characters: Vec::new(),
            tags: Vec::new(),
            note: String::new(),
            omitted: false,
            deleted: false,
            color_code: String::new(),
            color_label: String::new(),
            color_symbol: String::new(),
            day_number: Some(1),
            day_title: Some("Day 1".into()),
            total_eighths: None,
            total_scenes: None,
            banner_text: None,
        });

        for row in &bundle.scenes {
            scheduled.push(make_scene_strip(row, &snippets, &tags_by_scene));
        }
    } else {
        let stored = stored_schedule.unwrap();
        let mut seen_scenes: HashMap<String, bool> = HashMap::new();

            // Reconcile scheduled strips in their stored order (E3).
            for mut strip in stored.scheduled {
                if strip.kind == StripKind::Scene {
                    let sid = strip.scene_id.clone().unwrap_or_default();
                    if let Some(live) = live_scenes.get(sid.as_str()) {
                        seen_scenes.insert(sid.clone(), true);
                        // Refresh live script fields while keeping user note and schedule position (E3).
                        let (code, label, sym, _) = color_code_for(&live.int_ext, &live.time_of_day);
                        strip.scene_number = live.number.clone();
                        strip.heading = live.heading.clone();
                        strip.int_ext = live.int_ext.clone();
                        strip.location = live.location.clone();
                        strip.time_of_day = live.time_of_day.clone();
                        strip.page = live.page.clone();
                        strip.eighths = live.eighths;
                        strip.characters = live.speakers.clone();
                        strip.tags = tags_by_scene.get(&sid).cloned().unwrap_or_default();
                        strip.description = if !live.logline.trim().is_empty() {
                            live.logline.trim().to_string()
                        } else if let Some(snip) = snippets.get(&sid) {
                            snip.clone()
                        } else {
                            live.heading.clone()
                        };
                        strip.omitted = live.omitted;
                        strip.deleted = false;
                        strip.color_code = code.into();
                        strip.color_label = label.into();
                        strip.color_symbol = sym.into();
                    } else {
                        // Scene was deleted from the screenplay text: preserve in schedule, flag deleted (E4).
                        strip.omitted = true;
                        strip.deleted = true;
                    }
                }
                scheduled.push(strip);
            }

            // Reconcile unscheduled strips.
            for mut strip in stored.unscheduled {
                if strip.kind == StripKind::Scene {
                    let sid = strip.scene_id.clone().unwrap_or_default();
                    if let Some(live) = live_scenes.get(sid.as_str()) {
                        seen_scenes.insert(sid.clone(), true);
                        let (code, label, sym, _) = color_code_for(&live.int_ext, &live.time_of_day);
                        strip.scene_number = live.number.clone();
                        strip.heading = live.heading.clone();
                        strip.int_ext = live.int_ext.clone();
                        strip.location = live.location.clone();
                        strip.time_of_day = live.time_of_day.clone();
                        strip.page = live.page.clone();
                        strip.eighths = live.eighths;
                        strip.characters = live.speakers.clone();
                        strip.tags = tags_by_scene.get(&sid).cloned().unwrap_or_default();
                        strip.description = if !live.logline.trim().is_empty() {
                            live.logline.trim().to_string()
                        } else if let Some(snip) = snippets.get(&sid) {
                            snip.clone()
                        } else {
                            live.heading.clone()
                        };
                        strip.omitted = live.omitted;
                        strip.deleted = false;
                        strip.color_code = code.into();
                        strip.color_label = label.into();
                        strip.color_symbol = sym.into();
                    } else {
                        strip.omitted = true;
                        strip.deleted = true;
                    }
                }
                unscheduled.push(strip);
            }

            // Any live scene not present in scheduled or unscheduled joins unscheduled.
            for row in &bundle.scenes {
                if !seen_scenes.contains_key(&row.scene_id) {
                    unscheduled.push(make_scene_strip(row, &snippets, &tags_by_scene));
                }
            }
        }

    recalculate_day_breaks(&mut scheduled);

    let total_scenes = scheduled.iter().filter(|s| s.kind == StripKind::Scene).count();
    let total_eighths: u32 = scheduled.iter().filter(|s| s.kind == StripKind::Scene).map(|s| s.eighths).sum();
    let total_days = scheduled.iter().filter(|s| s.kind == StripKind::DayBreak).count() as u32;

    Ok(ScheduleState {
        scope: scope_key,
        scope_label: bundle.scope_label,
        scheduled,
        unscheduled,
        source_version: bundle.source_version,
        planning_version: bundle.planning_version,
        total_scheduled_scenes: total_scenes,
        total_scheduled_eighths: total_eighths,
        total_shooting_days: total_days,
    })
}

/// Sort strips in place by a criteria (natural alphanumeric scene number, int/ext, location, time of day, eighths, cast).
pub fn sort_strips(strips: &mut [Strip], sort_by: &str, ascending: bool) {
    strips.sort_by(|a, b| {
        // Keep DayBreaks and Banners anchored or compare them reasonably
        let order = match sort_by {
            "scene_number" => {
                let parse_key = |s: &str| -> (u32, String) {
                    let digits: String = s.chars().take_while(|c| c.is_ascii_digit()).collect();
                    let num = digits.parse::<u32>().unwrap_or(0);
                    (num, s.to_string())
                };
                let na = parse_key(&a.scene_number);
                let nb = parse_key(&b.scene_number);
                na.cmp(&nb)
            }
            "int_ext" => a.int_ext.cmp(&b.int_ext).then_with(|| a.location.cmp(&b.location)),
            "location" => a.location.cmp(&b.location).then_with(|| a.scene_number.cmp(&b.scene_number)),
            "time_of_day" => a.time_of_day.cmp(&b.time_of_day).then_with(|| a.location.cmp(&b.location)),
            "eighths" => a.eighths.cmp(&b.eighths).then_with(|| a.scene_number.cmp(&b.scene_number)),
            "characters" => {
                let ca = a.characters.join(", ");
                let cb = b.characters.join(", ");
                ca.cmp(&cb).then_with(|| a.scene_number.cmp(&b.scene_number))
            }
            _ => std::cmp::Ordering::Equal,
        };
        if ascending {
            order
        } else {
            order.reverse()
        }
    });
}

// ============================================================================
// Exports: HTML, PDF, XLSX, CSV (E9)
// ============================================================================

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Export the stripboard to a standalone printable HTML document with color legend
/// and full unclipped descriptions (E9).
pub fn export_html(state: &ScheduleState) -> String {
    let mut out = String::new();
    out.push_str("<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n");
    out.push_str("<title>Stripboard &amp; Schedule - ");
    out.push_str(&escape_html(&state.scope_label));
    out.push_str("</title>\n<style>\n");
    out.push_str(r#"
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 24px; color: #111; background: #fff; line-height: 1.4; font-size: 13px; }
h1 { margin: 0 0 4px 0; font-size: 20px; font-weight: 700; }
.meta { color: #555; margin-bottom: 16px; font-size: 12px; }
.legend { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 20px; padding: 10px; background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 6px; }
.legend-item { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 500; }
.swatch { width: 16px; height: 16px; border-radius: 3px; border: 1px solid rgba(0,0,0,0.2); display: inline-flex; align-items: center; justify-content: center; font-size: 10px; }
.strip-stack { display: flex; flex-direction: column; gap: 6px; margin-bottom: 28px; }
.day-break { background: #212529; color: #fff; padding: 10px 14px; border-radius: 6px; font-weight: 700; font-size: 14px; display: flex; justify-content: space-between; align-items: center; }
.day-break .stats { font-size: 12px; font-weight: 400; opacity: 0.85; }
.banner { background: #fd7e14; color: #fff; padding: 8px 14px; border-radius: 6px; font-weight: 700; text-align: center; text-transform: uppercase; letter-spacing: 0.5px; }
.strip { border: 1px solid #ced4da; border-radius: 6px; padding: 8px 12px; display: grid; gap: 4px; border-left-width: 8px; page-break-inside: avoid; }
.strip.day_int { background: #fffdf2; border-left-color: #ffd43b; }
.strip.night_int { background: #f0f7ff; border-left-color: #339af0; }
.strip.day_ext { background: #fff8f0; border-left-color: #ff922b; }
.strip.night_ext { background: #f2fbf4; border-left-color: #51cf66; }
.strip.other { background: #fbf8ff; border-left-color: #845ef9; }
.strip.omitted, .strip.deleted { opacity: 0.65; border-style: dashed; }
.strip-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 8px; font-weight: 600; font-size: 13px; }
.strip-title { display: inline-flex; align-items: center; gap: 8px; }
.badge { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; }
.badge-scene { background: #343a40; color: #fff; }
.badge-omitted { background: #e03131; color: #fff; }
.badge-deleted { background: #c92a2a; color: #fff; }
.strip-desc { color: #212529; white-space: pre-wrap; word-break: break-word; font-size: 12.5px; }
.strip-details { display: flex; flex-wrap: wrap; gap: 12px; font-size: 11.5px; color: #495057; }
.strip-note { background: rgba(0,0,0,0.04); padding: 4px 8px; border-radius: 4px; font-style: italic; font-size: 11.5px; }
@media print {
  body { margin: 0; padding: 12mm; }
  .strip { page-break-inside: avoid; }
  .day-break { page-break-before: auto; page-break-after: avoid; }
}
"#);
    out.push_str("</style>\n</head>\n<body>\n");

    out.push_str("<h1>Stripboard &amp; Shooting Schedule</h1>\n");
    out.push_str(&format!(
        "<div class=\"meta\">Scope: {} · Script v{} · Planning v{} · {} scenes · {} pages (estimate) · {} shooting day{}</div>\n",
        escape_html(&state.scope_label),
        state.source_version,
        state.planning_version,
        state.total_scheduled_scenes,
        fmt_eighths(state.total_scheduled_eighths),
        state.total_shooting_days,
        if state.total_shooting_days == 1 { "" } else { "s" }
    ));

    // Color Legend (E3, E9)
    out.push_str("<div class=\"legend\" role=\"region\" aria-label=\"Color Legend\">\n");
    for &(_code, label, sym, hex) in &[COLOR_DAY_INT, COLOR_NIGHT_INT, COLOR_DAY_EXT, COLOR_NIGHT_EXT, COLOR_OTHER] {
        out.push_str(&format!(
            "<div class=\"legend-item\"><span class=\"swatch\" style=\"background:{};\">{}</span><span>{}</span></div>\n",
            hex, sym, label
        ));
    }
    out.push_str("</div>\n");

    // Scheduled Strips
    out.push_str("<div class=\"strip-stack\">\n");
    for s in &state.scheduled {
        render_strip_html(&mut out, s);
    }
    out.push_str("</div>\n");

    // Unscheduled Strips
    if !state.unscheduled.is_empty() {
        out.push_str("<h2 style=\"margin-top: 32px;\">Unscheduled Scenes</h2>\n");
        out.push_str("<div class=\"strip-stack\">\n");
        for s in &state.unscheduled {
            render_strip_html(&mut out, s);
        }
        out.push_str("</div>\n");
    }

    out.push_str("</body>\n</html>\n");
    out
}

fn render_strip_html(out: &mut String, s: &Strip) {
    match s.kind {
        StripKind::DayBreak => {
            let title = s.day_title.as_deref().unwrap_or("Day Break");
            let scenes_str = match s.total_scenes {
                Some(c) => format!("{c} scene{}", if c == 1 { "" } else { "s" }),
                None => String::new(),
            };
            let eighths_str = match s.total_eighths {
                Some(e) => format!(" · {} pgs", fmt_eighths(e)),
                None => String::new(),
            };
            out.push_str(&format!(
                "<div class=\"day-break\"><span>{}</span><span class=\"stats\">{}{}</span></div>\n",
                escape_html(title),
                scenes_str,
                eighths_str
            ));
            if !s.note.trim().is_empty() {
                out.push_str(&format!("<div class=\"strip-note\">Note: {}</div>\n", escape_html(&s.note)));
            }
        }
        StripKind::Banner => {
            let text = s.banner_text.as_deref().unwrap_or("Banner");
            out.push_str(&format!("<div class=\"banner\">{}</div>\n", escape_html(text)));
            if !s.note.trim().is_empty() {
                out.push_str(&format!("<div class=\"strip-note\">Note: {}</div>\n", escape_html(&s.note)));
            }
        }
        StripKind::Scene => {
            let mut cls = format!("strip {}", s.color_code);
            if s.omitted {
                cls.push_str(" omitted");
            }
            if s.deleted {
                cls.push_str(" deleted");
            }

            out.push_str(&format!("<div class=\"{cls}\">\n"));
            out.push_str("<div class=\"strip-head\">\n<div class=\"strip-title\">\n");
            out.push_str(&format!("<span class=\"badge badge-scene\">SCENE {}</span>\n", escape_html(&s.scene_number)));
            if s.deleted {
                out.push_str("<span class=\"badge badge-deleted\">[DELETED]</span>\n");
            } else if s.omitted {
                out.push_str("<span class=\"badge badge-omitted\">[OMITTED]</span>\n");
            }
            out.push_str(&format!("<span>{}</span>\n", escape_html(&s.heading)));
            out.push_str("</div>\n");
            out.push_str(&format!(
                "<div><span>{} {}</span> · <span>{}</span> · <span>Page {}</span></div>\n",
                s.color_symbol, s.color_label, s.fmt_pages(), s.page
            ));
            out.push_str("</div>\n");

            // Description: wrapped, full text, never clipped (E9)
            if !s.description.is_empty() {
                out.push_str(&format!("<div class=\"strip-desc\">{}</div>\n", escape_html(&s.description)));
            }

            out.push_str("<div class=\"strip-details\">\n");
            if !s.characters.is_empty() {
                out.push_str(&format!("<div><strong>Cast:</strong> {}</div>\n", escape_html(&s.characters.join(", "))));
            }
            if !s.tags.is_empty() {
                out.push_str(&format!("<div><strong>Tags:</strong> {}</div>\n", escape_html(&s.tags.join("; "))));
            }
            out.push_str("</div>\n");

            if !s.note.trim().is_empty() {
                out.push_str(&format!("<div class=\"strip-note\"><strong>Schedule Note:</strong> {}</div>\n", escape_html(&s.note)));
            }

            out.push_str("</div>\n");
        }
    }
}

/// Export stripboard to a formatted PDF with repeated page headers, color legend on page 1,
/// and wrapped descriptions preventing any text clipping (E9).
pub fn export_pdf(state: &ScheduleState, p: &Profile, date_unix: i64) -> std::result::Result<Vec<u8>, String> {
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

    let push_line = |cur_lines: &mut Vec<PLine>, row_idx: &mut usize, text: String, bold: bool| {
        cur_lines.push(PLine {
            row: *row_idx,
            x_in,
            segs: vec![Seg { text, bold, italic: false, underline: false }],
            block_id: None,
            kind: "action",
            start: 0,
            end: 0,
            synthetic: false,
        });
        *row_idx += 1;
    };

    // Header on Page 1
    push_line(&mut cur_lines, &mut row_idx, "STRIPBOARD & SHOOTING SCHEDULE".into(), true);
    let meta = format!(
        "Scope: {} · Script v{} · Planning v{} · {} scenes · {} pages (estimate) · {} days",
        state.scope_label,
        state.source_version,
        state.planning_version,
        state.total_scheduled_scenes,
        fmt_eighths(state.total_scheduled_eighths),
        state.total_shooting_days
    );
    for (a, b) in layout::wrap(&meta, total_cols) {
        push_line(&mut cur_lines, &mut row_idx, meta.chars().skip(a).take(b.saturating_sub(a)).collect(), false);
    }
    push_line(&mut cur_lines, &mut row_idx, "Page and eighth lengths are estimates from layout.".into(), false);
    row_idx += 1;

    // Color Legend on Page 1 (E3, E9)
    push_line(&mut cur_lines, &mut row_idx, "COLOR LEGEND:".into(), true);
    let legend_str = format!(
        "{} {}   {} {}   {} {}   {} {}   {} {}",
        COLOR_DAY_INT.2, COLOR_DAY_INT.1,
        COLOR_NIGHT_INT.2, COLOR_NIGHT_INT.1,
        COLOR_DAY_EXT.2, COLOR_DAY_EXT.1,
        COLOR_NIGHT_EXT.2, COLOR_NIGHT_EXT.1,
        COLOR_OTHER.2, COLOR_OTHER.1
    );
    for (a, b) in layout::wrap(&legend_str, total_cols) {
        push_line(&mut cur_lines, &mut row_idx, legend_str.chars().skip(a).take(b.saturating_sub(a)).collect(), false);
    }
    row_idx += 1;

    // Helper to render one strip to lines
    let render_strip_pdf_lines = |s: &Strip, total_cols: usize| -> Vec<(String, bool)> {
        let mut lines = Vec::new();
        match s.kind {
            StripKind::DayBreak => {
                let title = s.day_title.as_deref().unwrap_or("Day Break");
                let count = s.total_scenes.unwrap_or(0);
                let eighths = s.total_eighths.unwrap_or(0);
                let bar = format!(
                    "--- {} ({} scene{}, {} pgs) ---",
                    title.to_uppercase(),
                    count,
                    if count == 1 { "" } else { "s" },
                    fmt_eighths(eighths)
                );
                lines.push((bar, true));
                if !s.note.trim().is_empty() {
                    lines.push((format!("    Note: {}", s.note.trim()), false));
                }
            }
            StripKind::Banner => {
                let text = s.banner_text.as_deref().unwrap_or("BANNER");
                lines.push((format!("=== {} ===", text.to_uppercase()), true));
                if !s.note.trim().is_empty() {
                    lines.push((format!("    Note: {}", s.note.trim()), false));
                }
            }
            StripKind::Scene => {
                let status_tag = if s.deleted {
                    " [DELETED]"
                } else if s.omitted {
                    " [OMITTED]"
                } else {
                    ""
                };

                let head = format!(
                    "SCENE {}{}  {}  ({} {})  {}  PG {}",
                    s.scene_number,
                    status_tag,
                    s.heading,
                    s.color_symbol,
                    s.color_label,
                    s.fmt_pages(),
                    s.page
                );
                for (a, b) in layout::wrap(&head, total_cols) {
                    lines.push((head.chars().skip(a).take(b.saturating_sub(a)).collect(), true));
                }

                // Description: multi-line wrapping so no text clips (E9)
                if !s.description.trim().is_empty() {
                    let desc = s.description.trim();
                    for (a, b) in layout::wrap(desc, total_cols.saturating_sub(4)) {
                        let seg: String = desc.chars().skip(a).take(b.saturating_sub(a)).collect();
                        lines.push((format!("    {}", seg), false));
                    }
                }

                if !s.characters.is_empty() {
                    let cast = format!("    Cast: {}", s.characters.join(", "));
                    for (a, b) in layout::wrap(&cast, total_cols) {
                        lines.push((cast.chars().skip(a).take(b.saturating_sub(a)).collect(), false));
                    }
                }

                if !s.tags.is_empty() {
                    let tags = format!("    Tags: {}", s.tags.join("; "));
                    for (a, b) in layout::wrap(&tags, total_cols) {
                        lines.push((tags.chars().skip(a).take(b.saturating_sub(a)).collect(), false));
                    }
                }

                if !s.note.trim().is_empty() {
                    let n = format!("    Note: {}", s.note.trim());
                    for (a, b) in layout::wrap(&n, total_cols) {
                        lines.push((n.chars().skip(a).take(b.saturating_sub(a)).collect(), false));
                    }
                }
            }
        }
        lines
    };

    // Render Scheduled Strips
    for s in &state.scheduled {
        let strip_lines = render_strip_pdf_lines(s, total_cols);
        // Avoid splitting a strip across pages if it fits entirely on a fresh page
        if row_idx + strip_lines.len() + 1 > body_lines && !cur_lines.is_empty() {
            flush_page(&mut pages, &mut cur_lines, &mut row_idx);
        }

        for (text, bold) in strip_lines {
            if row_idx >= body_lines {
                flush_page(&mut pages, &mut cur_lines, &mut row_idx);
            }
            push_line(&mut cur_lines, &mut row_idx, text, bold);
        }
        row_idx += 1; // blank separator line between strips
    }

    // Render Unscheduled Strips
    if !state.unscheduled.is_empty() {
        if row_idx + 4 > body_lines && !cur_lines.is_empty() {
            flush_page(&mut pages, &mut cur_lines, &mut row_idx);
        }
        row_idx += 1;
        push_line(&mut cur_lines, &mut row_idx, "=== UNSCHEDULED SCENES ===".into(), true);
        row_idx += 1;

        for s in &state.unscheduled {
            let strip_lines = render_strip_pdf_lines(s, total_cols);
            if row_idx + strip_lines.len() + 1 > body_lines && !cur_lines.is_empty() {
                flush_page(&mut pages, &mut cur_lines, &mut row_idx);
            }
            for (text, bold) in strip_lines {
                if row_idx >= body_lines {
                    flush_page(&mut pages, &mut cur_lines, &mut row_idx);
                }
                push_line(&mut cur_lines, &mut row_idx, text, bold);
            }
            row_idx += 1;
        }
    }

    flush_page(&mut pages, &mut cur_lines, &mut row_idx);

    let map = PageMap {
        profile: p.name,
        engine: layout::ENGINE_VERSION,
        doc_version: state.source_version,
        body_lines,
        pages,
        page_starts: Vec::new(),
        warnings: Vec::new(),
    };

    let opts = PdfOptions {
        title: format!("Stripboard ({})", state.scope_label),
        author: "Kolbítar".into(),
        subject: format!("{} · Script v{}", state.scope_label, state.source_version),
        date_unix,
        document_id: format!("stripboard-{}", state.scope),
        header: format!("STRIPBOARD · {} · v{}", state.scope_label, state.source_version),
        footer: "Page and eighth lengths are estimates.".into(),
        revision_header: String::new(),
    };

    pdf::render_document(&map, p, None, &opts)
}

/// Export stripboard schedule to an XLSX OpenXML workbook using the approved `zip` crate.
pub fn export_xlsx(state: &ScheduleState) -> std::result::Result<Vec<u8>, String> {
    let mut cursor = Cursor::new(Vec::new());
    let mut zip = ZipWriter::new(&mut cursor);
    let opts = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);

    let write_file = |zip: &mut ZipWriter<&mut Cursor<Vec<u8>>>, name: &str, content: &str| -> std::result::Result<(), String> {
        zip.start_file(name, opts).map_err(|e| e.to_string())?;
        zip.write_all(content.as_bytes()).map_err(|e| e.to_string())
    };

    // Static OpenXML packaging files
    write_file(
        &mut zip,
        "[Content_Types].xml",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>"#,
    )?;

    write_file(
        &mut zip,
        "_rels/.rels",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"#,
    )?;

    write_file(
        &mut zip,
        "xl/_rels/workbook.xml.rels",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>"#,
    )?;

    write_file(
        &mut zip,
        "xl/workbook.xml",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Schedule" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>"#,
    )?;

    write_file(
        &mut zip,
        "xl/styles.xml",
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><name val="Calibri"/><sz val="11"/></font>
    <font><b/><name val="Calibri"/><sz val="11"/></font>
  </fonts>
  <fills count="2">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
  </cellXfs>
</styleSheet>"#,
    )?;

    // Build sheet1.xml rows
    let mut sheet = String::new();
    sheet.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n");
    sheet.push_str("<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">\n<sheetData>\n");

    let headers = [
        "Order", "Type", "Day #", "Scene #", "Status", "Color", "INT/EXT", "Location", "Time of Day",
        "Eighths", "Pages (Est.)", "Start Page", "Description", "Characters", "Tags", "Notes"
    ];

    // Row 1: Headers
    sheet.push_str("<row r=\"1\">\n");
    for (ci, h) in headers.iter().enumerate() {
        let col = col_letter(ci);
        sheet.push_str(&format!("<c r=\"{col}1\" t=\"inlineStr\" s=\"1\"><is><t>{}</t></is></c>", escape_xml(h)));
    }
    sheet.push_str("</row>\n");

    let mut current_day = 0u32;
    let mut row_num = 2usize;

    let write_strip_row = |sheet: &mut String, row_num: usize, order_idx: usize, s: &Strip, cur_day: u32| {
        sheet.push_str(&format!("<row r=\"{row_num}\">\n"));
        let (stype, status) = match s.kind {
            StripKind::DayBreak => ("Day Break", "Active"),
            StripKind::Banner => ("Banner", "Active"),
            StripKind::Scene => (
                "Scene",
                if s.deleted { "Deleted" } else if s.omitted { "Omitted" } else { "Active" },
            ),
        };

        let day_str = if s.kind == StripKind::DayBreak {
            s.day_number.unwrap_or(cur_day).to_string()
        } else if cur_day > 0 {
            cur_day.to_string()
        } else {
            String::new()
        };

        let cells: Vec<String> = vec![
            order_idx.to_string(),
            stype.into(),
            day_str,
            s.scene_number.clone(),
            status.into(),
            s.color_label.clone(),
            s.int_ext.clone(),
            s.location.clone(),
            s.time_of_day.clone(),
            if s.kind == StripKind::Scene { s.eighths.to_string() } else { String::new() },
            if s.kind == StripKind::Scene { s.fmt_pages() } else { String::new() },
            s.page.clone(),
            if s.kind == StripKind::Banner { s.banner_text.clone().unwrap_or_default() } else { s.description.clone() },
            s.characters.join(", "),
            s.tags.join("; "),
            s.note.clone(),
        ];

        for (ci, val) in cells.iter().enumerate() {
            let col = col_letter(ci);
            let safe_val = sanitize_cell(val);
            sheet.push_str(&format!("<c r=\"{col}{row_num}\" t=\"inlineStr\"><is><t>{}</t></is></c>", escape_xml(&safe_val)));
        }
        sheet.push_str("</row>\n");
    };

    for (idx, s) in state.scheduled.iter().enumerate() {
        if s.kind == StripKind::DayBreak {
            current_day = s.day_number.unwrap_or(current_day + 1);
        }
        write_strip_row(&mut sheet, row_num, idx + 1, s, current_day);
        row_num += 1;
    }

    for (idx, s) in state.unscheduled.iter().enumerate() {
        write_strip_row(&mut sheet, row_num, state.scheduled.len() + idx + 1, s, 0);
        row_num += 1;
    }

    sheet.push_str("</sheetData>\n</worksheet>");
    write_file(&mut zip, "xl/worksheets/sheet1.xml", &sheet)?;

    zip.finish().map_err(|e| e.to_string())?;
    Ok(cursor.into_inner())
}

/// Export stripboard schedule to CSV or TSV format with UTF-8 encoding and formula safety.
pub fn export_csv(state: &ScheduleState, delimiter: char) -> String {
    let mut out = String::new();
    let headers = [
        "Order", "Type", "Day #", "Scene #", "Status", "Color", "INT/EXT", "Location", "Time of Day",
        "Eighths", "Pages (Est.)", "Start Page", "Description", "Characters", "Tags", "Notes"
    ];

    out.push_str(&headers.iter().map(|h| format_csv_cell(h, delimiter)).collect::<Vec<_>>().join(&delimiter.to_string()));
    out.push('\n');

    let mut current_day = 0u32;
    let mut order_idx = 1usize;

    let write_csv_row = |out: &mut String, idx: usize, s: &Strip, cur_day: u32| {
        let (stype, status) = match s.kind {
            StripKind::DayBreak => ("Day Break", "Active"),
            StripKind::Banner => ("Banner", "Active"),
            StripKind::Scene => (
                "Scene",
                if s.deleted { "Deleted" } else if s.omitted { "Omitted" } else { "Active" },
            ),
        };
        let day_str = if s.kind == StripKind::DayBreak {
            s.day_number.unwrap_or(cur_day).to_string()
        } else if cur_day > 0 {
            cur_day.to_string()
        } else {
            String::new()
        };

        let desc = if s.kind == StripKind::Banner {
            s.banner_text.as_deref().unwrap_or("")
        } else {
            s.description.as_str()
        };

        let eighths_str = if s.kind == StripKind::Scene { s.eighths.to_string() } else { String::new() };
        let pages_str = if s.kind == StripKind::Scene { s.fmt_pages() } else { String::new() };

        let cells = [
            idx.to_string(),
            stype.into(),
            day_str,
            s.scene_number.clone(),
            status.into(),
            s.color_label.clone(),
            s.int_ext.clone(),
            s.location.clone(),
            s.time_of_day.clone(),
            eighths_str,
            pages_str,
            s.page.clone(),
            desc.to_string(),
            s.characters.join(", "),
            s.tags.join("; "),
            s.note.clone(),
        ];

        let line = cells.iter().map(|c| format_csv_cell(c, delimiter)).collect::<Vec<_>>().join(&delimiter.to_string());
        out.push_str(&line);
        out.push('\n');
    };

    for s in &state.scheduled {
        if s.kind == StripKind::DayBreak {
            current_day = s.day_number.unwrap_or(current_day + 1);
        }
        write_csv_row(&mut out, order_idx, s, current_day);
        order_idx += 1;
    }

    for s in &state.unscheduled {
        write_csv_row(&mut out, order_idx, s, 0);
        order_idx += 1;
    }

    out
}

fn col_letter(mut idx: usize) -> String {
    let mut s = String::new();
    loop {
        let rem = idx % 26;
        s.insert(0, (b'A' + rem as u8) as char);
        if idx < 26 {
            break;
        }
        idx = idx / 26 - 1;
    }
    s
}

fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// Protect against CSV formula injection while preserving numeric signs.
fn sanitize_cell(s: &str) -> String {
    let trimmed = s.trim();
    if (trimmed.starts_with('=') || trimmed.starts_with('+') || trimmed.starts_with('-') || trimmed.starts_with('@') || trimmed.starts_with('\t') || trimmed.starts_with('\r'))
        && trimmed.parse::<f64>().is_err()
    {
        format!("'{s}")
    } else {
        s.to_string()
    }
}

fn format_csv_cell(s: &str, delimiter: char) -> String {
    let safe = sanitize_cell(s);
    if safe.contains(delimiter) || safe.contains('"') || safe.contains('\n') || safe.contains('\r') {
        format!("\"{}\"", safe.replace('"', "\"\""))
    } else {
        safe
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn color_code_assignments_match_industry_standards() {
        assert_eq!(color_code_for("INT.", "DAY").0, "day_int");
        assert_eq!(color_code_for("INT.", "NIGHT").0, "night_int");
        assert_eq!(color_code_for("EXT.", "DAY").0, "day_ext");
        assert_eq!(color_code_for("EXT.", "NIGHT").0, "night_ext");
        assert_eq!(color_code_for("INT./EXT.", "DAY").0, "other");
    }

    #[test]
    fn day_breaks_aggregate_scenes_and_eighths() {
        let mut strips = vec![
            Strip {
                id: "db1".into(),
                kind: StripKind::DayBreak,
                ..Strip::default_scene()
            },
            Strip {
                id: "s1".into(),
                kind: StripKind::Scene,
                eighths: 3,
                ..Strip::default_scene()
            },
            Strip {
                id: "s2".into(),
                kind: StripKind::Scene,
                eighths: 5,
                ..Strip::default_scene()
            },
            Strip {
                id: "db2".into(),
                kind: StripKind::DayBreak,
                ..Strip::default_scene()
            },
            Strip {
                id: "s3".into(),
                kind: StripKind::Scene,
                eighths: 4,
                ..Strip::default_scene()
            },
        ];

        recalculate_day_breaks(&mut strips);
        assert_eq!(strips[0].day_number, Some(1));
        assert_eq!(strips[0].total_scenes, Some(2));
        assert_eq!(strips[0].total_eighths, Some(8));

        assert_eq!(strips[3].day_number, Some(2));
        assert_eq!(strips[3].total_scenes, Some(1));
        assert_eq!(strips[3].total_eighths, Some(4));
    }

    #[test]
    fn html_export_includes_color_legend_and_no_clipped_descriptions() {
        let state = ScheduleState {
            scope: "project".into(),
            scope_label: "Whole Project".into(),
            scheduled: vec![
                Strip {
                    id: "db1".into(),
                    kind: StripKind::DayBreak,
                    day_number: Some(1),
                    day_title: Some("Day 1 - Studio".into()),
                    total_scenes: Some(1),
                    total_eighths: Some(4),
                    ..Strip::default_scene()
                },
                Strip {
                    id: "s1".into(),
                    kind: StripKind::Scene,
                    scene_number: "1".into(),
                    heading: "INT. WAREHOUSE - NIGHT".into(),
                    int_ext: "INT.".into(),
                    time_of_day: "NIGHT".into(),
                    description: "Mara checks the shipping containers with a flashlight. Very detailed multi-sentence description that must not be clipped in any export layout.".into(),
                    eighths: 4,
                    color_code: "night_int".into(),
                    color_label: "Night Interior".into(),
                    color_symbol: "●".into(),
                    note: "Bring extra battery packs".into(),
                    ..Strip::default_scene()
                },
            ],
            unscheduled: Vec::new(),
            source_version: 1,
            planning_version: 1,
            total_scheduled_scenes: 1,
            total_scheduled_eighths: 4,
            total_shooting_days: 1,
        };

        let html = export_html(&state);
        assert!(html.contains("Color Legend"));
        assert!(html.contains("Day Interior"));
        assert!(html.contains("Night Interior"));
        assert!(html.contains("Very detailed multi-sentence description"));
        assert!(html.contains("Bring extra battery packs"));

        let csv = export_csv(&state, ',');
        assert!(csv.contains("Mara checks the shipping containers"));
        assert!(csv.contains("Night Interior"));
    }
}

impl Strip {
    pub fn default_scene() -> Self {
        Strip {
            id: String::new(),
            kind: StripKind::Scene,
            document_id: String::new(),
            document_title: String::new(),
            scene_id: None,
            scene_number: String::new(),
            heading: String::new(),
            int_ext: String::new(),
            location: String::new(),
            time_of_day: String::new(),
            description: String::new(),
            page: "1".into(),
            eighths: 0,
            characters: Vec::new(),
            tags: Vec::new(),
            note: String::new(),
            omitted: false,
            deleted: false,
            color_code: String::new(),
            color_label: String::new(),
            color_symbol: String::new(),
            day_number: None,
            day_title: None,
            total_eighths: None,
            total_scenes: None,
            banner_text: None,
        }
    }
}
