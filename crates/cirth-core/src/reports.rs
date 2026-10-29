//! Production reports and StoryScry row data (M4 step 1, ACCEPTANCE B6, E6–E8).
//!
//! Every report is computed from the canonical scripts, their page maps,
//! locked scene numbers, outline cards, the project bible and revision sets
//! for a chosen scope (this script, chosen episodes or the whole project,
//! with omitted scenes in or out) and stamped with the store's script and
//! planning versions so the UI can show when later edits make a report out
//! of date (B6). Charts and tables read the same rows (E8).
//!
//! Lengths in eighths of a page are estimates from the layout engine's rows
//! and are labelled as estimates in the UI. Dual dialogue counts each
//! speaker's speech once without double-counting scene length.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::bible::{Entity, TAG_CATEGORIES};
use crate::layout::{self, PageMap, Profile};
use crate::locked::PageLock;
use crate::model::{Beat, Block, BlockKind, Id};
use crate::navigator::{self, cue_name};
use crate::numbering::Numbers;
use crate::revisions::{self, RevisionSet};
use crate::store::{Result as StoreResult, Store};
use crate::tags::Tag;

/// Which scripts a report covers, and whether omitted scenes are counted.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct ReportScope {
    /// "document" (the open script), "episodes" (the ids in `documents`), or "project".
    pub mode: String,
    /// Document ids when `mode == "episodes"` (or a single id when `mode == "document"`).
    pub documents: Vec<Id>,
    /// Whether scenes marked omitted under locked scene numbers are included.
    pub include_omitted: bool,
}

/// One script included in a report's scope.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScopeDoc {
    pub id: Id,
    pub title: String,
}

/// All inputs for one document in scope, so reports can be tested with or
/// without a SQLite store.
#[derive(Clone, Debug)]
pub struct DocInput {
    pub id: Id,
    pub title: String,
    pub profile: Profile,
    pub blocks: Vec<Block>,
    pub beats: Vec<Beat>,
    pub numbers: Numbers,
    pub page_lock: Option<PageLock>,
    pub revision_sets: Vec<RevisionSet>,
    pub active_revision: Option<String>,
    pub tags: Vec<Tag>,
}

impl Default for DocInput {
    fn default() -> Self {
        DocInput {
            id: String::new(),
            title: String::new(),
            profile: Profile::us_letter(),
            blocks: Vec::new(),
            beats: Vec::new(),
            numbers: Numbers::new(),
            page_lock: None,
            revision_sets: Vec::new(),
            active_revision: None,
            tags: Vec::new(),
        }
    }
}

/// Scene report row (one-liner).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SceneRow {
    pub document_id: Id,
    pub document_title: String,
    pub scene_id: Id,
    /// Locked scene number when numbered, otherwise position ("1", "2", …).
    pub number: String,
    pub omitted: bool,
    pub heading: String,
    /// "INT.", "EXT.", "INT./EXT." or "Other".
    pub int_ext: String,
    pub location: String,
    pub time_of_day: String,
    pub page: String,
    /// Length in eighths of a page (estimate).
    pub eighths: u32,
    pub speakers: Vec<String>,
    /// Number of dual-dialogue pairs in this scene (simultaneous speech).
    pub dual_pairs: u32,
    /// Authored logline from the first linked beat card, if any.
    pub logline: String,
}

/// One scene where a character participates (speaking, tagged as silent cast, or both).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CharacterSceneRef {
    pub document_id: Id,
    pub document_title: String,
    pub scene_id: Id,
    pub scene_number: String,
    pub page: String,
    pub heading: String,
    pub eighths: u32,
    /// "speaking", "silent", or "both" (spoke and also tagged as cast in action).
    pub role: String,
}

/// Character report row (speaking, silent presence from cast tags, and estimated participation time; E6, E7).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CharacterRow {
    pub name: String,
    pub speeches: u32,
    /// Speeches delivered as voice-over (`(V.O.)`).
    pub vo_speeches: u32,
    /// Speeches delivered off-screen / off-camera (`(O.S.)`, `(O.C.)`).
    pub os_speeches: u32,
    /// Speeches that are part of a dual-dialogue pair (simultaneous speech).
    pub dual_speeches: u32,
    pub words: u64,
    /// Percentage of all spoken words in scope (0.0–100.0, one decimal place).
    pub share_pct: f64,
    /// Scenes in which this character speaks (kept as `scenes` for compatibility).
    pub scenes: usize,
    /// Scenes in which this character is tagged as `cast` in action text without speaking (E6).
    pub silent_scenes: usize,
    /// Total distinct scenes containing this character (`scenes + silent_scenes`).
    pub total_scenes: usize,
    /// Sum of full scene lengths in eighths across all `total_scenes` (estimate; overlaps across characters, E7).
    pub participation_eighths: u32,
    /// Estimated scene participation duration in minutes (`participation_eighths / 8.0` at 1 page ≈ 1 min; estimate, never "screen time", E6, E7).
    pub participation_minutes_est: f64,
    /// Estimated dialogue speaking duration in minutes (`words / 150.0` at 150 wpm; estimate, E6).
    pub dialogue_minutes_est: f64,
    /// Every distinct scene containing this character, in script order.
    pub scene_links: Vec<CharacterSceneRef>,
    pub first_document_id: Id,
    pub first_document_title: String,
    pub first_scene_id: Id,
    pub first_scene_number: String,
    pub first_page: String,
}

/// One distinct scene where a breakdown tag item appears (E1, E2).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TagSceneRef {
    pub document_id: Id,
    pub document_title: String,
    pub scene_id: Id,
    pub scene_number: String,
    pub page: String,
    pub heading: String,
    pub eighths: u32,
    /// Number of tag occurrences for this item in this scene (E2).
    pub occurrences: usize,
    /// Distinct quoted text spans tagged in this scene.
    pub quotes: Vec<String>,
}

/// One tagged bible entry within a breakdown category report (E1, E2).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TagItemRow {
    pub entity_id: Id,
    pub name: String,
    pub aliases: Vec<String>,
    pub category: String,
    pub category_label: String,
    /// Total tag occurrences across included scenes in scope (E2).
    pub occurrences: usize,
    /// Distinct scenes containing this item in scope (E2).
    pub scenes: usize,
    /// Total eighths across distinct scenes containing this item (estimate).
    pub eighths: u32,
    /// Distinct non-empty production notes on tags of this item.
    pub notes: Vec<String>,
    /// Every distinct scene where this item is tagged, in script order (E1).
    pub scene_links: Vec<TagSceneRef>,
    pub first_document_id: Id,
    pub first_document_title: String,
    pub first_scene_id: Id,
    pub first_scene_number: String,
    pub first_page: String,
}

/// Breakdown report for a single tag category (Props, Costume, Cast, or custom; E1, E2).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TagCategoryReport {
    pub category: String,
    pub label: String,
    /// Total non-orphaned tag occurrences in this category across included scenes in scope.
    pub total_occurrences: usize,
    /// Distinct included scenes in scope that contain at least one tag in this category.
    pub distinct_scenes: usize,
    pub rows: Vec<TagItemRow>,
}

/// Location report row.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LocationRow {
    pub name: String,
    /// "INT.", "EXT.", "INT./EXT." or "Mixed".
    pub int_ext: String,
    pub scenes: usize,
    /// Total eighths across scenes at this location (estimate).
    pub eighths: u32,
    pub first_document_id: Id,
    pub first_document_title: String,
    pub first_scene_id: Id,
    pub first_scene_number: String,
    pub first_page: String,
    pub last_document_id: Id,
    pub last_document_title: String,
    pub last_scene_id: Id,
    pub last_scene_number: String,
    pub last_page: String,
}

/// Per-scene row in the Action vs Dialogue report.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ActionDialogueSceneRow {
    pub document_id: Id,
    pub document_title: String,
    pub scene_id: Id,
    pub number: String,
    pub heading: String,
    pub page: String,
    pub eighths: u32,
    pub action_words: u64,
    pub dialogue_words: u64,
    pub action_lines: usize,
    pub dialogue_lines: usize,
    pub dialogue_word_pct: f64,
}

/// Action vs dialogue summary and per-scene rows.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct ActionDialogueReport {
    pub action_words: u64,
    pub dialogue_words: u64,
    pub action_lines: usize,
    pub dialogue_lines: usize,
    pub action_word_pct: f64,
    pub dialogue_word_pct: f64,
    pub action_line_pct: f64,
    pub dialogue_line_pct: f64,
    pub scenes: Vec<ActionDialogueSceneRow>,
}

/// Breakdown bucket for Interior vs Exterior and Day vs Night reports.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BucketRow {
    pub label: String,
    pub scenes: usize,
    /// Total eighths in this bucket (estimate).
    pub eighths: u32,
    pub scene_pct: f64,
    pub eighths_pct: f64,
}

/// Revision set report row.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RevisionRow {
    pub document_id: Id,
    pub document_title: String,
    pub set_id: Id,
    pub label: String,
    pub colour: String,
    pub date: String,
    pub mark: String,
    pub author: String,
    pub active: bool,
    pub changed_pages: usize,
    pub page_labels: Vec<String>,
    pub passages: usize,
}

/// Stamped bundle of all reports for a chosen scope.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ReportBundle {
    /// Store script version (`Store::version`) when computed.
    pub source_version: u64,
    /// Store planning version (`Store::planning_version`) when computed.
    pub planning_version: u64,
    pub scope: ReportScope,
    /// Human-readable description of the scope ("This script: Pilot (omitted scenes excluded)").
    pub scope_label: String,
    pub documents: Vec<ScopeDoc>,
    /// All scripts in the project (in tree order), so the UI can offer an episode picker.
    pub all_documents: Vec<ScopeDoc>,
    pub include_omitted: bool,
    /// Total omitted scenes present in the selected documents.
    pub omitted_in_scope: usize,
    /// Total pages across the selected documents.
    pub total_pages: usize,
    /// Sum of scene eighths across included scenes (estimate).
    pub total_eighths: u32,
    pub scenes: Vec<SceneRow>,
    pub characters: Vec<CharacterRow>,
    pub locations: Vec<LocationRow>,
    pub action_dialogue: ActionDialogueReport,
    pub int_ext: Vec<BucketRow>,
    pub day_night: Vec<BucketRow>,
    pub revisions: Vec<RevisionRow>,
    pub tag_reports: Vec<TagCategoryReport>,
    #[serde(default)]
    pub alternatives: Vec<AlternativeRow>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AlternativeRow {
    pub document_id: String,
    pub block_id: String,
    pub take_index: u32,
    pub text: String,
    pub label: String,
    pub is_active: bool,
    /// Unambiguous display label for StoryScry and reports (Acceptance E5).
    pub display_label: String,
}

/// Parsed parts of a scene heading: `("INT.", "COUNTING HOUSE", "NIGHT")`.
pub fn parse_heading(heading: &str) -> (String, String, String) {
    let upper = heading.trim().to_uppercase();
    let prefixes: [(&str, &str); 10] = [
        ("INT./EXT.", "INT./EXT."),
        ("EXT./INT.", "INT./EXT."),
        ("INT/EXT", "INT./EXT."),
        ("I/E.", "INT./EXT."),
        ("I/E", "INT./EXT."),
        ("INT.", "INT."),
        ("EXT.", "EXT."),
        ("EST.", "EXT."),
        ("INT ", "INT."),
        ("EXT ", "EXT."),
    ];
    let (int_ext, rest) = prefixes
        .iter()
        .find_map(|(p, norm)| upper.strip_prefix(p).map(|r| (*norm, r)))
        .unwrap_or(("Other", upper.as_str()));
    let rest = rest.trim().trim_start_matches('.').trim();
    let parts: Vec<&str> = rest.split(" - ").map(str::trim).filter(|s| !s.is_empty()).collect();
    match parts.as_slice() {
        [] => (int_ext.into(), String::new(), String::new()),
        [only] => (int_ext.into(), (*only).into(), String::new()),
        [first, .., last] => (int_ext.into(), (*first).into(), (*last).into()),
    }
}

fn pct(part: f64, whole: f64) -> f64 {
    if whole <= 0.0 {
        0.0
    } else {
        ((part / whole) * 1000.0).round() / 10.0
    }
}

fn alias_map(entities: &[Entity], kinds: &[&str]) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for e in entities.iter().filter(|e| kinds.contains(&e.kind.as_str())) {
        let canon = e.name.trim().to_uppercase();
        if canon.is_empty() {
            continue;
        }
        for n in std::iter::once(&e.name).chain(e.aliases.iter()) {
            let k = n.trim().to_uppercase();
            if !k.is_empty() {
                map.entry(k).or_insert_with(|| canon.clone());
            }
        }
    }
    map
}

/// Inspect parenthesized cue extensions (e.g. `"MARA (V.O.)"`, `"TOBIAS (O.S.) (CONT'D)"`):
/// returns `(is_vo, is_os)`.
pub fn cue_extensions(cue: &str) -> (bool, bool) {
    let mut is_vo = false;
    let mut is_os = false;
    let mut rest = cue.trim().trim_end_matches('^').trim();
    while let Some(open) = rest.rfind('(') {
        if !rest.ends_with(')') {
            break;
        }
        let inner: String = rest[open + 1..rest.len() - 1]
            .chars()
            .filter(|c| !matches!(c, '.' | ' ' | '-'))
            .flat_map(char::to_uppercase)
            .collect();
        match inner.as_str() {
            "VO" | "VOICEOVER" => is_vo = true,
            "OS" | "OC" | "OFFSCREEN" | "OFFCAMERA" => is_os = true,
            _ => {}
        }
        rest = rest[..open].trim_end();
    }
    (is_vo, is_os)
}

/// Compute all reports for `docs` (already filtered to the requested scope).
pub fn compute(
    docs: &[DocInput],
    all_documents: Vec<ScopeDoc>,
    entities: &[Entity],
    scope: ReportScope,
    source_version: u64,
    planning_version: u64,
) -> ReportBundle {
    compute_with_tags(docs, all_documents, entities, &[], scope, source_version, planning_version)
}

/// Compute all reports for `docs` including breakdown tag category reports (`tag_categories`)
/// and silent character participation from `cast` tags.
pub fn compute_with_tags(
    docs: &[DocInput],
    all_documents: Vec<ScopeDoc>,
    entities: &[Entity],
    tag_categories: &[(String, String)],
    scope: ReportScope,
    source_version: u64,
    planning_version: u64,
) -> ReportBundle {
    let char_aliases = alias_map(entities, &["character", "cast"]);
    let loc_aliases = alias_map(entities, &["location"]);
    let entity_by_id: HashMap<&str, &Entity> = entities.iter().map(|e| (e.id.as_str(), e)).collect();

    let categories: Vec<(String, String)> = if tag_categories.is_empty() {
        TAG_CATEGORIES.iter().map(|(k, l)| ((*k).to_string(), (*l).to_string())).collect()
    } else {
        tag_categories.to_vec()
    };

    let mut scenes_out: Vec<SceneRow> = Vec::new();
    let mut ad_scenes: Vec<ActionDialogueSceneRow> = Vec::new();
    let mut revisions_out: Vec<RevisionRow> = Vec::new();
    let mut total_pages = 0usize;
    let mut total_eighths = 0u32;
    let mut omitted_in_scope = 0usize;

    // Character tracking across included scenes.
    struct CharAcc {
        name: String,
        speeches: u32,
        vo_speeches: u32,
        os_speeches: u32,
        dual_speeches: u32,
        words: u64,
        speaking_scenes: usize,
        silent_scenes: usize,
        participation_eighths: u32,
        scene_links: Vec<CharacterSceneRef>,
        first_doc_id: Id,
        first_doc_title: String,
        first_scene_id: Id,
        first_scene_number: String,
        first_page: String,
    }
    let mut char_list: Vec<CharAcc> = Vec::new();
    let mut char_idx: HashMap<String, usize> = HashMap::new();

    // Breakdown tag tracking across included scenes, keyed by `(category, entity_key)`.
    struct TagAcc {
        entity_id: Id,
        name: String,
        aliases: Vec<String>,
        category: String,
        occurrences: usize,
        eighths: u32,
        notes: Vec<String>,
        scene_links: Vec<TagSceneRef>,
    }
    let mut tag_list: Vec<TagAcc> = Vec::new();
    let mut tag_idx: HashMap<(String, String), usize> = HashMap::new();

    // Location tracking across included scenes.
    struct LocAcc {
        name: String,
        int_exts: HashSet<String>,
        scenes: usize,
        eighths: u32,
        first_doc_id: Id,
        first_doc_title: String,
        first_scene_id: Id,
        first_scene_number: String,
        first_page: String,
        last_doc_id: Id,
        last_doc_title: String,
        last_scene_id: Id,
        last_scene_number: String,
        last_page: String,
    }
    let mut loc_list: Vec<LocAcc> = Vec::new();
    let mut loc_idx: HashMap<String, usize> = HashMap::new();

    // Action vs dialogue overall counters.
    let mut total_action_words = 0u64;
    let mut total_dialogue_words = 0u64;
    let mut total_action_lines = 0usize;
    let mut total_dialogue_lines = 0usize;

    for doc in docs {
        // Production page map (with omissions as printed) for page counts and revisions.
        let prod_map = layout::paginate_production(&doc.blocks, &doc.profile, source_version, &doc.numbers, doc.page_lock.as_ref());
        total_pages += prod_map.pages.len();

        // When `include_omitted` is true, lay out with omitted scenes expanded so
        // their eighths, lines and speakers are measured rather than collapsed to "OMITTED".
        let stats_map: PageMap = if scope.include_omitted && doc.numbers.values().any(|n| n.omitted) {
            let mut unomitted = doc.numbers.clone();
            for n in unomitted.values_mut() {
                n.omitted = false;
            }
            layout::paginate_production(&doc.blocks, &doc.profile, source_version, &unomitted, doc.page_lock.as_ref())
        } else {
            prod_map.clone()
        };

        let scene_stats = navigator::scene_stats(&doc.blocks, &stats_map);
        let mut stat_by_scene: HashMap<&str, &navigator::SceneStat> = HashMap::new();
        for st in &scene_stats {
            stat_by_scene.insert(st.scene_id.as_str(), st);
        }

        // Count wrapped lines per block from `stats_map`.
        let mut action_lines_by_block: HashMap<&str, usize> = HashMap::new();
        let mut dialogue_lines_by_block: HashMap<&str, usize> = HashMap::new();
        for p in &stats_map.pages {
            for l in &p.lines {
                if l.synthetic {
                    continue;
                }
                let Some(bid) = l.block_id.as_deref() else { continue };
                match l.kind {
                    "action" => *action_lines_by_block.entry(bid).or_insert(0) += 1,
                    "dialogue" | "lyric" => *dialogue_lines_by_block.entry(bid).or_insert(0) += 1,
                    _ => {}
                }
            }
        }

        // First linked beat logline per scene.
        let mut logline_by_scene: HashMap<&str, &str> = HashMap::new();
        for b in &doc.beats {
            if b.kind == "beat" && !b.logline.trim().is_empty() {
                if let Some(sid) = b.scene_id.as_deref() {
                    logline_by_scene.entry(sid).or_insert(b.logline.trim());
                }
            }
        }

        // Index non-orphaned breakdown tags in this document by `block_id`.
        let mut tags_by_block: HashMap<&str, Vec<&Tag>> = HashMap::new();
        for t in &doc.tags {
            if !t.orphaned {
                tags_by_block.entry(t.block_id.as_str()).or_default().push(t);
            }
        }

        // Group blocks by scene (blocks before the first heading belong to no scene).
        let mut doc_scenes: Vec<(Id, Vec<&Block>)> = Vec::new();
        for b in &doc.blocks {
            if let (BlockKind::Heading, Some(sid)) = (b.kind, &b.scene_id) {
                doc_scenes.push((sid.clone(), vec![b]));
            } else if let Some(last) = doc_scenes.last_mut() {
                last.1.push(b);
            } else {
                // Pre-heading blocks still contribute to overall action/dialogue counts.
                match b.kind {
                    BlockKind::Action => {
                        total_action_words += crate::words::count(&b.text());
                        total_action_lines += action_lines_by_block.get(b.id.as_str()).copied().unwrap_or(0);
                    }
                    BlockKind::Dialogue | BlockKind::Lyric => {
                        total_dialogue_words += crate::words::count(&b.text());
                        total_dialogue_lines += dialogue_lines_by_block.get(b.id.as_str()).copied().unwrap_or(0);
                    }
                    _ => {}
                }
            }
        }

        let ensure_char = |name: &str,
                           char_idx: &mut HashMap<String, usize>,
                           char_list: &mut Vec<CharAcc>,
                           doc_id: &str,
                           doc_title: &str,
                           sid: &str,
                           number: &str,
                           page: &str|
         -> usize {
            *char_idx.entry(name.to_string()).or_insert_with(|| {
                char_list.push(CharAcc {
                    name: name.to_string(),
                    speeches: 0,
                    vo_speeches: 0,
                    os_speeches: 0,
                    dual_speeches: 0,
                    words: 0,
                    speaking_scenes: 0,
                    silent_scenes: 0,
                    participation_eighths: 0,
                    scene_links: Vec::new(),
                    first_doc_id: doc_id.to_string(),
                    first_doc_title: doc_title.to_string(),
                    first_scene_id: sid.to_string(),
                    first_scene_number: number.to_string(),
                    first_page: page.to_string(),
                });
                char_list.len() - 1
            })
        };

        for (idx, (sid, bs)) in doc_scenes.iter().enumerate() {
            let num_entry = doc.numbers.get(sid);
            let omitted = num_entry.is_some_and(|n| n.omitted);
            if omitted {
                omitted_in_scope += 1;
                if !scope.include_omitted {
                    continue;
                }
            }
            let number = num_entry.map(|n| n.number.clone()).unwrap_or_else(|| (idx + 1).to_string());
            let heading = bs[0].text();
            let (int_ext, raw_loc, time_of_day) = parse_heading(&heading);
            let location = if raw_loc.is_empty() {
                String::new()
            } else {
                loc_aliases.get(&raw_loc).cloned().unwrap_or(raw_loc)
            };
            let st = stat_by_scene.get(sid.as_str());
            let page = st.map(|s| s.page.clone()).unwrap_or_default();
            let eighths = st.map(|s| s.eighths).unwrap_or(1);
            total_eighths += eighths;

            let mut speakers: Vec<String> = Vec::new();
            let mut speaking_cis_in_scene: Vec<usize> = Vec::new();
            let mut cast_tagged_cis_in_scene: Vec<usize> = Vec::new();
            let mut dual_pairs = 0u32;
            let mut scene_action_words = 0u64;
            let mut scene_dialogue_words = 0u64;
            let mut scene_action_lines = 0usize;
            let mut scene_dialogue_lines = 0usize;

            // Walk blocks in the scene for speakers, character stats, dual pairs, action/dialogue and breakdown tags.
            let mut current_speaker: Option<usize> = None;
            let mut prev_speaker_in_scene: Option<usize> = None;
            for b in bs {
                match b.kind {
                    BlockKind::Character => {
                        let cue_txt = b.text();
                        let raw = cue_name(&cue_txt);
                        if raw.is_empty() {
                            current_speaker = None;
                            continue;
                        }
                        let (is_vo, is_os) = cue_extensions(&cue_txt);
                        let name = char_aliases.get(&raw).cloned().unwrap_or(raw);
                        if !speakers.contains(&name) {
                            speakers.push(name.clone());
                        }
                        let ci = ensure_char(&name, &mut char_idx, &mut char_list, &doc.id, &doc.title, sid, &number, &page);
                        char_list[ci].speeches += 1;
                        if is_vo {
                            char_list[ci].vo_speeches += 1;
                        }
                        if is_os {
                            char_list[ci].os_speeches += 1;
                        }
                        if b.dual {
                            dual_pairs += 1;
                            char_list[ci].dual_speeches += 1;
                            if let Some(prev) = prev_speaker_in_scene {
                                if prev != ci {
                                    char_list[prev].dual_speeches += 1;
                                }
                            }
                        }
                        if !speaking_cis_in_scene.contains(&ci) {
                            speaking_cis_in_scene.push(ci);
                        }
                        prev_speaker_in_scene = Some(ci);
                        current_speaker = Some(ci);
                    }
                    BlockKind::Dialogue | BlockKind::Lyric => {
                        let w = crate::words::count(&b.text());
                        let l = dialogue_lines_by_block.get(b.id.as_str()).copied().unwrap_or(0);
                        scene_dialogue_words += w;
                        scene_dialogue_lines += l;
                        if let Some(ci) = current_speaker {
                            char_list[ci].words += w;
                        }
                    }
                    BlockKind::Parenthetical => {}
                    BlockKind::Action => {
                        current_speaker = None;
                        scene_action_words += crate::words::count(&b.text());
                        scene_action_lines += action_lines_by_block.get(b.id.as_str()).copied().unwrap_or(0);
                    }
                    _ => {
                        current_speaker = None;
                    }
                }

                // Process breakdown tags attached to this block.
                if let Some(btags) = tags_by_block.get(b.id.as_str()) {
                    for t in btags {
                        let ent = entity_by_id.get(t.entity_id.as_str()).copied();
                        let item_name = ent
                            .map(|e| e.name.trim().to_string())
                            .filter(|s| !s.is_empty())
                            .unwrap_or_else(|| t.quote.trim().to_string());
                        let item_aliases = ent.map(|e| e.aliases.clone()).unwrap_or_default();
                        let entity_key = if !t.entity_id.trim().is_empty() {
                            t.entity_id.clone()
                        } else {
                            item_name.to_uppercase()
                        };

                        let ti = *tag_idx.entry((t.category.clone(), entity_key.clone())).or_insert_with(|| {
                            tag_list.push(TagAcc {
                                entity_id: t.entity_id.clone(),
                                name: item_name.clone(),
                                aliases: item_aliases,
                                category: t.category.clone(),
                                occurrences: 0,
                                eighths: 0,
                                notes: Vec::new(),
                                scene_links: Vec::new(),
                            });
                            tag_list.len() - 1
                        });
                        let tacc = &mut tag_list[ti];
                        tacc.occurrences += 1;
                        let note_trim = t.note.trim();
                        if !note_trim.is_empty() && !tacc.notes.iter().any(|n| n == note_trim) {
                            tacc.notes.push(note_trim.to_string());
                        }
                        let quote_trim = t.quote.trim();
                        if let Some(last_sc) = tacc.scene_links.last_mut().filter(|s| s.document_id == doc.id && s.scene_id == *sid) {
                            last_sc.occurrences += 1;
                            if !quote_trim.is_empty() && !last_sc.quotes.iter().any(|q| q == quote_trim) {
                                last_sc.quotes.push(quote_trim.to_string());
                            }
                        } else {
                            tacc.eighths += eighths;
                            tacc.scene_links.push(TagSceneRef {
                                document_id: doc.id.clone(),
                                document_title: doc.title.clone(),
                                scene_id: sid.clone(),
                                scene_number: number.clone(),
                                page: page.clone(),
                                heading: heading.clone(),
                                eighths,
                                occurrences: 1,
                                quotes: if quote_trim.is_empty() { Vec::new() } else { vec![quote_trim.to_string()] },
                            });
                        }

                        // If this is a `cast` breakdown tag, also track character presence in this scene (E6).
                        if t.category == "cast" {
                            let raw_char = item_name.trim().to_uppercase();
                            if !raw_char.is_empty() {
                                let canon_char = char_aliases.get(&raw_char).cloned().unwrap_or(raw_char);
                                let ci = ensure_char(&canon_char, &mut char_idx, &mut char_list, &doc.id, &doc.title, sid, &number, &page);
                                if !cast_tagged_cis_in_scene.contains(&ci) {
                                    cast_tagged_cis_in_scene.push(ci);
                                }
                            }
                        }
                    }
                }
            }

            // Record scene participation for characters who spoke or were tagged as cast in this scene (E6, E7).
            for &ci in &speaking_cis_in_scene {
                let also_tagged = cast_tagged_cis_in_scene.contains(&ci);
                let c = &mut char_list[ci];
                c.speaking_scenes += 1;
                c.participation_eighths += eighths;
                c.scene_links.push(CharacterSceneRef {
                    document_id: doc.id.clone(),
                    document_title: doc.title.clone(),
                    scene_id: sid.clone(),
                    scene_number: number.clone(),
                    page: page.clone(),
                    heading: heading.clone(),
                    eighths,
                    role: if also_tagged { "both".into() } else { "speaking".into() },
                });
            }
            for &ci in &cast_tagged_cis_in_scene {
                if speaking_cis_in_scene.contains(&ci) {
                    continue;
                }
                let c = &mut char_list[ci];
                c.silent_scenes += 1;
                c.participation_eighths += eighths;
                c.scene_links.push(CharacterSceneRef {
                    document_id: doc.id.clone(),
                    document_title: doc.title.clone(),
                    scene_id: sid.clone(),
                    scene_number: number.clone(),
                    page: page.clone(),
                    heading: heading.clone(),
                    eighths,
                    role: "silent".into(),
                });
            }

            total_action_words += scene_action_words;
            total_dialogue_words += scene_dialogue_words;
            total_action_lines += scene_action_lines;
            total_dialogue_lines += scene_dialogue_lines;

            if !location.is_empty() {
                let li = *loc_idx.entry(location.clone()).or_insert_with(|| {
                    loc_list.push(LocAcc {
                        name: location.clone(),
                        int_exts: HashSet::new(),
                        scenes: 0,
                        eighths: 0,
                        first_doc_id: doc.id.clone(),
                        first_doc_title: doc.title.clone(),
                        first_scene_id: sid.clone(),
                        first_scene_number: number.clone(),
                        first_page: page.clone(),
                        last_doc_id: doc.id.clone(),
                        last_doc_title: doc.title.clone(),
                        last_scene_id: sid.clone(),
                        last_scene_number: number.clone(),
                        last_page: page.clone(),
                    });
                    loc_list.len() - 1
                });
                let loc = &mut loc_list[li];
                loc.int_exts.insert(int_ext.clone());
                loc.scenes += 1;
                loc.eighths += eighths;
                loc.last_doc_id = doc.id.clone();
                loc.last_doc_title = doc.title.clone();
                loc.last_scene_id = sid.clone();
                loc.last_scene_number = number.clone();
                loc.last_page = page.clone();
            }

            let scene_total_words = (scene_action_words + scene_dialogue_words) as f64;
            ad_scenes.push(ActionDialogueSceneRow {
                document_id: doc.id.clone(),
                document_title: doc.title.clone(),
                scene_id: sid.clone(),
                number: number.clone(),
                heading: heading.clone(),
                page: page.clone(),
                eighths,
                action_words: scene_action_words,
                dialogue_words: scene_dialogue_words,
                action_lines: scene_action_lines,
                dialogue_lines: scene_dialogue_lines,
                dialogue_word_pct: pct(scene_dialogue_words as f64, scene_total_words),
            });

            scenes_out.push(SceneRow {
                document_id: doc.id.clone(),
                document_title: doc.title.clone(),
                scene_id: sid.clone(),
                number,
                omitted,
                heading,
                int_ext,
                location,
                time_of_day: if time_of_day.is_empty() { "Unspecified".into() } else { time_of_day },
                page,
                eighths,
                speakers,
                dual_pairs,
                logline: logline_by_scene.get(sid.as_str()).copied().unwrap_or_default().to_string(),
            });
        }

        // Revisions per set in this document.
        for set in &doc.revision_sets {
            let mut map_copy = prod_map.clone();
            let changed_pages = revisions::mark_pages(&mut map_copy, &doc.blocks, set);
            let page_labels: Vec<String> = map_copy.pages.iter().filter(|p| p.revised).map(|p| p.label.clone()).collect();
            let passages = revisions::passages(&doc.blocks, &set.id);
            revisions_out.push(RevisionRow {
                document_id: doc.id.clone(),
                document_title: doc.title.clone(),
                set_id: set.id.clone(),
                label: set.label.clone(),
                colour: set.colour.clone(),
                date: set.date.clone(),
                mark: if set.mark.trim().is_empty() { "*".into() } else { set.mark.trim().into() },
                author: set.author.clone(),
                active: doc.active_revision.as_deref() == Some(set.id.as_str()),
                changed_pages,
                page_labels,
                passages,
            });
        }
    }

    // Finalize character rows (most speeches first, then words, then total scenes, then name).
    let all_spoken_words: f64 = char_list.iter().map(|c| c.words as f64).sum();
    let mut characters_out: Vec<CharacterRow> = char_list
        .into_iter()
        .map(|c| {
            let total_scenes = c.speaking_scenes + c.silent_scenes;
            let participation_minutes_est = ((c.participation_eighths as f64 / 8.0) * 10.0).round() / 10.0;
            let dialogue_minutes_est = ((c.words as f64 / 150.0) * 10.0).round() / 10.0;
            CharacterRow {
                name: c.name,
                speeches: c.speeches,
                vo_speeches: c.vo_speeches,
                os_speeches: c.os_speeches,
                dual_speeches: c.dual_speeches,
                words: c.words,
                share_pct: pct(c.words as f64, all_spoken_words),
                scenes: c.speaking_scenes,
                silent_scenes: c.silent_scenes,
                total_scenes,
                participation_eighths: c.participation_eighths,
                participation_minutes_est,
                dialogue_minutes_est,
                scene_links: c.scene_links,
                first_document_id: c.first_doc_id,
                first_document_title: c.first_doc_title,
                first_scene_id: c.first_scene_id,
                first_scene_number: c.first_scene_number,
                first_page: c.first_page,
            }
        })
        .collect();
    characters_out.sort_by(|a, b| {
        b.speeches
            .cmp(&a.speeches)
            .then_with(|| b.words.cmp(&a.words))
            .then_with(|| b.total_scenes.cmp(&a.total_scenes))
            .then_with(|| a.name.cmp(&b.name))
    });

    // Finalize breakdown tag category reports (E1, E2).
    let mut cat_label_map: HashMap<String, String> = categories.iter().cloned().collect();
    let mut all_cats = categories;
    for t in &tag_list {
        if !cat_label_map.contains_key(&t.category) {
            cat_label_map.insert(t.category.clone(), t.category.clone());
            all_cats.push((t.category.clone(), t.category.clone()));
        }
    }
    let mut by_cat: HashMap<String, Vec<TagItemRow>> = HashMap::new();
    for t in tag_list {
        let first = t.scene_links.first();
        let cat_label = cat_label_map.get(&t.category).cloned().unwrap_or_else(|| t.category.clone());
        let row = TagItemRow {
            entity_id: t.entity_id,
            name: t.name,
            aliases: t.aliases,
            category: t.category.clone(),
            category_label: cat_label,
            occurrences: t.occurrences,
            scenes: t.scene_links.len(),
            eighths: t.eighths,
            notes: t.notes,
            first_document_id: first.map(|s| s.document_id.clone()).unwrap_or_default(),
            first_document_title: first.map(|s| s.document_title.clone()).unwrap_or_default(),
            first_scene_id: first.map(|s| s.scene_id.clone()).unwrap_or_default(),
            first_scene_number: first.map(|s| s.scene_number.clone()).unwrap_or_default(),
            first_page: first.map(|s| s.page.clone()).unwrap_or_default(),
            scene_links: t.scene_links,
        };
        by_cat.entry(t.category).or_default().push(row);
    }
    let mut tag_reports = Vec::with_capacity(all_cats.len());
    for (cat_key, cat_label) in all_cats {
        let mut rows = by_cat.remove(&cat_key).unwrap_or_default();
        rows.sort_by(|a, b| {
            b.scenes
                .cmp(&a.scenes)
                .then_with(|| b.occurrences.cmp(&a.occurrences))
                .then_with(|| a.name.cmp(&b.name))
        });
        let total_occurrences: usize = rows.iter().map(|r| r.occurrences).sum();
        let mut scene_set: HashSet<(&str, &str)> = HashSet::new();
        for r in &rows {
            for s in &r.scene_links {
                scene_set.insert((s.document_id.as_str(), s.scene_id.as_str()));
            }
        }
        let distinct_scenes = scene_set.len();
        tag_reports.push(TagCategoryReport {
            category: cat_key,
            label: cat_label,
            total_occurrences,
            distinct_scenes,
            rows,
        });
    }

    // Finalize location rows (most scenes first, then eighths, then name).
    let mut locations_out: Vec<LocationRow> = loc_list
        .into_iter()
        .map(|l| {
            let int_ext = if l.int_exts.len() == 1 {
                l.int_exts.into_iter().next().unwrap()
            } else {
                "Mixed".into()
            };
            LocationRow {
                name: l.name,
                int_ext,
                scenes: l.scenes,
                eighths: l.eighths,
                first_document_id: l.first_doc_id,
                first_document_title: l.first_doc_title,
                first_scene_id: l.first_scene_id,
                first_scene_number: l.first_scene_number,
                first_page: l.first_page,
                last_document_id: l.last_doc_id,
                last_document_title: l.last_doc_title,
                last_scene_id: l.last_scene_id,
                last_scene_number: l.last_scene_number,
                last_page: l.last_page,
            }
        })
        .collect();
    locations_out.sort_by(|a, b| b.scenes.cmp(&a.scenes).then_with(|| b.eighths.cmp(&a.eighths)).then_with(|| a.name.cmp(&b.name)));

    // Finalize Action vs Dialogue report.
    let total_words = (total_action_words + total_dialogue_words) as f64;
    let total_lines = (total_action_lines + total_dialogue_lines) as f64;
    let action_dialogue = ActionDialogueReport {
        action_words: total_action_words,
        dialogue_words: total_dialogue_words,
        action_lines: total_action_lines,
        dialogue_lines: total_dialogue_lines,
        action_word_pct: pct(total_action_words as f64, total_words),
        dialogue_word_pct: pct(total_dialogue_words as f64, total_words),
        action_line_pct: pct(total_action_lines as f64, total_lines),
        dialogue_line_pct: pct(total_dialogue_lines as f64, total_lines),
        scenes: ad_scenes,
    };

    // Finalize Interior vs Exterior buckets in fixed order ("INT.", "EXT.", "INT./EXT.", "Other").
    let scene_total_f = scenes_out.len() as f64;
    let eighths_total_f = total_eighths as f64;
    let mut ie_counts: HashMap<&str, (usize, u32)> = HashMap::new();
    for s in &scenes_out {
        let key = match s.int_ext.as_str() {
            "INT." => "INT.",
            "EXT." => "EXT.",
            "INT./EXT." => "INT./EXT.",
            _ => "Other",
        };
        let e = ie_counts.entry(key).or_insert((0, 0));
        e.0 += 1;
        e.1 += s.eighths;
    }
    let mut int_ext_out = Vec::new();
    for key in ["INT.", "EXT.", "INT./EXT.", "Other"] {
        let (sc, ei) = ie_counts.get(key).copied().unwrap_or((0, 0));
        if sc > 0 || key != "Other" {
            int_ext_out.push(BucketRow {
                label: key.into(),
                scenes: sc,
                eighths: ei,
                scene_pct: pct(sc as f64, scene_total_f),
                eighths_pct: pct(ei as f64, eighths_total_f),
            });
        }
    }

    // Finalize Day vs Night (time of day) buckets.
    let mut tod_map: HashMap<String, (usize, u32)> = HashMap::new();
    for s in &scenes_out {
        let e = tod_map.entry(s.time_of_day.clone()).or_insert((0, 0));
        e.0 += 1;
        e.1 += s.eighths;
    }
    let mut day_night_out: Vec<BucketRow> = tod_map
        .into_iter()
        .map(|(label, (sc, ei))| BucketRow {
            label,
            scenes: sc,
            eighths: ei,
            scene_pct: pct(sc as f64, scene_total_f),
            eighths_pct: pct(ei as f64, eighths_total_f),
        })
        .collect();
    day_night_out.sort_by(|a, b| b.scenes.cmp(&a.scenes).then_with(|| b.eighths.cmp(&a.eighths)).then_with(|| a.label.cmp(&b.label)));

    let documents: Vec<ScopeDoc> = docs.iter().map(|d| ScopeDoc { id: d.id.clone(), title: d.title.clone() }).collect();
    let base_scope = match scope.mode.as_str() {
        "project" => format!("Whole project ({} script{})", documents.len(), if documents.len() == 1 { "" } else { "s" }),
        "episodes" => {
            let titles: Vec<&str> = documents.iter().map(|d| if d.title.is_empty() { "(untitled)" } else { d.title.as_str() }).collect();
            format!("Selected scripts ({}): {}", documents.len(), titles.join(", "))
        }
        _ => {
            let title = documents.first().map(|d| d.title.as_str()).filter(|t| !t.is_empty()).unwrap_or("(untitled)");
            format!("This script: {title}")
        }
    };
    let omitted_note = if omitted_in_scope == 0 {
        String::new()
    } else if scope.include_omitted {
        format!(" · {omitted_in_scope} omitted scene{} included", if omitted_in_scope == 1 { "" } else { "s" })
    } else {
        format!(" · {omitted_in_scope} omitted scene{} excluded", if omitted_in_scope == 1 { "" } else { "s" })
    };
    let scope_label = format!("{base_scope}{omitted_note}");

    ReportBundle {
        source_version,
        planning_version,
        scope: scope.clone(),
        scope_label,
        documents,
        all_documents,
        include_omitted: scope.include_omitted,
        omitted_in_scope,
        total_pages,
        total_eighths,
        scenes: scenes_out,
        characters: characters_out,
        locations: locations_out,
        action_dialogue,
        int_ext: int_ext_out,
        day_night: day_night_out,
        revisions: revisions_out,
        tag_reports,
        alternatives: Vec::new(),
    }
}

/// Build the report bundle directly from an open `Store`.
pub fn from_store(store: &Store, scope: &ReportScope) -> StoreResult<ReportBundle> {
    let source_version = store.version()?;
    let planning_version = store.planning_version()?;
    let all = store.all_documents()?;
    let all_documents: Vec<ScopeDoc> = all.iter().map(|(id, title, _)| ScopeDoc { id: id.clone(), title: title.clone() }).collect();
    let current = store.current_document()?;

    let chosen_ids: Vec<Id> = match scope.mode.as_str() {
        "project" => all.iter().map(|(id, _, _)| id.clone()).collect(),
        "episodes" => {
            let wanted: HashSet<&str> = scope.documents.iter().map(String::as_str).collect();
            let picked: Vec<Id> = all.iter().filter(|(id, _, _)| wanted.contains(id.as_str())).map(|(id, _, _)| id.clone()).collect();
            if picked.is_empty() { vec![current] } else { picked }
        }
        _ => vec![scope.documents.first().cloned().unwrap_or(current)],
    };

    let mut docs = Vec::with_capacity(chosen_ids.len());
    for id in &chosen_ids {
        let doc = store.load_document(id)?;
        let prof_name = store.document_profile(id).unwrap_or_else(|_| "us-letter".into());
        let profile = if prof_name == "a4" { Profile::a4() } else { Profile::us_letter() };
        let beats = store.beats_of(id)?;
        let numbers = store.scene_numbers(id)?;
        let page_lock = store.page_lock(id)?;
        let revision_sets = store.revision_sets(id)?;
        let active_revision = store.active_revision(id)?.map(|s| s.id);
        let tags = store.tags_of(id)?;
        docs.push(DocInput {
            id: id.clone(),
            title: doc.title,
            profile,
            blocks: doc.blocks,
            beats,
            numbers,
            page_lock,
            revision_sets,
            active_revision,
            tags,
        });
    }

    let entities = store.entities()?;
    let tag_categories = store.tag_categories()?;
    let normalized_scope = ReportScope {
        mode: if matches!(scope.mode.as_str(), "project" | "episodes") { scope.mode.clone() } else { "document".into() },
        documents: chosen_ids,
        include_omitted: scope.include_omitted,
    };

    let mut bundle = compute_with_tags(
        &docs,
        all_documents,
        &entities,
        &tag_categories,
        normalized_scope,
        source_version,
        planning_version,
    );

    let mut alts_out = Vec::new();
    for id in &bundle.scope.documents {
        for alt in store.all_block_alternatives(id)? {
            let display_label = if alt.is_active {
                format!("Take {} (Active)", alt.take_index + 1)
            } else {
                format!("(Inactive alternative: Take {} - {})", alt.take_index + 1, alt.label)
            };
            alts_out.push(AlternativeRow {
                document_id: alt.document_id,
                block_id: alt.block_id,
                take_index: alt.take_index,
                text: alt.text,
                label: alt.label,
                is_active: alt.is_active,
                display_label,
            });
        }
    }
    bundle.alternatives = alts_out;

    Ok(bundle)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Block, BlockKind, Run};
    use crate::numbering::SceneNumber;

    fn b(kind: BlockKind, text: &str) -> Block {
        Block::new(kind, text)
    }

    #[test]
    fn heading_parser_splits_prefix_location_and_time_of_day() {
        assert_eq!(
            parse_heading("INT. COUNTING HOUSE - NIGHT"),
            ("INT.".into(), "COUNTING HOUSE".into(), "NIGHT".into())
        );
        assert_eq!(
            parse_heading("ext. harbour wall - dawn"),
            ("EXT.".into(), "HARBOUR WALL".into(), "DAWN".into())
        );
        assert_eq!(
            parse_heading("INT./EXT. CAR - MOVING - DAY"),
            ("INT./EXT.".into(), "CAR".into(), "DAY".into())
        );
        assert_eq!(
            parse_heading("MONTAGE - THE WINTER"),
            ("Other".into(), "MONTAGE".into(), "THE WINTER".into())
        );
    }

    #[test]
    fn reports_cover_scope_omitted_scenes_aliases_dual_dialogue_and_revisions() {
        let mut s1 = b(BlockKind::Heading, "INT. COUNTING HOUSE - DAY");
        let s1_id = s1.scene_id.clone().unwrap();
        let mut s2 = b(BlockKind::Heading, "EXT. HARBOUR - NIGHT");
        let s2_id = s2.scene_id.clone().unwrap();
        let mut s3 = b(BlockKind::Heading, "INT./EXT. BOAT - DAWN");
        let s3_id = s3.scene_id.clone().unwrap();
        s1.id = "b_s1".into();
        s2.id = "b_s2".into();
        s3.id = "b_s3".into();

        let mut dual_right = b(BlockKind::Character, "PELL");
        dual_right.dual = true;

        let mut rev_action = b(BlockKind::Action, "");
        rev_action.runs = vec![Run { revision: Some("r1".into()), ..Run::plain("Mara checks the red ledger.") }];

        let blocks1 = vec![
            s1,
            rev_action,
            b(BlockKind::Character, "MARA"),
            b(BlockKind::Dialogue, "One two three four."),
            dual_right,
            b(BlockKind::Dialogue, "Five six."),
            s2,
            b(BlockKind::Action, "Waves break over the stones."),
            b(BlockKind::Character, "OLD MARA (V.O.)"),
            b(BlockKind::Dialogue, "Seven eight."),
            s3,
            b(BlockKind::Action, "An omitted scene on the boat."),
            b(BlockKind::Character, "GHOST"),
            b(BlockKind::Dialogue, "Nobody hears this when omitted."),
        ];

        let mut numbers = Numbers::new();
        numbers.insert(s1_id.clone(), SceneNumber { scene_id: s1_id.clone(), number: "1".into(), omitted: false });
        numbers.insert(s2_id.clone(), SceneNumber { scene_id: s2_id.clone(), number: "2".into(), omitted: false });
        numbers.insert(s3_id.clone(), SceneNumber { scene_id: s3_id.clone(), number: "3".into(), omitted: true });

        let beat1 = Beat {
            id: "beat1".into(),
            logline: "Mara balances the books.".into(),
            summary: String::new(),
            scene_id: Some(s1_id.clone()),
            pos: 1.0,
            kind: "beat".into(),
            title: String::new(),
            parent: None,
        };

        let rev_set = RevisionSet {
            id: "r1".into(),
            label: "Blue Revision".into(),
            colour: "blue".into(),
            date: "2026-10-28".into(),
            mark: "*".into(),
            author: "J.H.".into(),
        };

        let doc1 = DocInput {
            id: "ep1".into(),
            title: "Episode 1".into(),
            profile: Profile::us_letter(),
            blocks: blocks1,
            beats: vec![beat1],
            numbers,
            page_lock: None,
            revision_sets: vec![rev_set],
            active_revision: Some("r1".into()),
            tags: Vec::new(),
        };

        let doc2 = DocInput {
            id: "ep2".into(),
            title: "Episode 2".into(),
            profile: Profile::us_letter(),
            blocks: vec![
                b(BlockKind::Heading, "EXT. PIER - DAY"),
                b(BlockKind::Character, "PELL"),
                b(BlockKind::Dialogue, "Nine ten."),
            ],
            beats: Vec::new(),
            numbers: Numbers::new(),
            page_lock: None,
            revision_sets: Vec::new(),
            active_revision: None,
            tags: Vec::new(),
        };

        // Bible entity merges "OLD MARA" alias under "MARA VEY" and "PIER" under "HARBOUR".
        let entities = vec![
            Entity {
                id: "e_mara".into(),
                kind: "character".into(),
                name: "Mara Vey".into(),
                aliases: vec!["MARA".into(), "OLD MARA".into()],
                ..Default::default()
            },
            Entity {
                id: "e_harbour".into(),
                kind: "location".into(),
                name: "Harbour".into(),
                aliases: vec!["PIER".into()],
                ..Default::default()
            },
        ];

        let all_docs = vec![
            ScopeDoc { id: "ep1".into(), title: "Episode 1".into() },
            ScopeDoc { id: "ep2".into(), title: "Episode 2".into() },
        ];

        // 1. Episode 1 only, omitted scenes excluded (default).
        let rep = compute(
            std::slice::from_ref(&doc1),
            all_docs.clone(),
            &entities,
            ReportScope { mode: "document".into(), documents: vec!["ep1".into()], include_omitted: false },
            42,
            7,
        );
        assert_eq!(rep.source_version, 42);
        assert_eq!(rep.planning_version, 7);
        assert_eq!(rep.omitted_in_scope, 1);
        assert_eq!(rep.scenes.len(), 2, "omitted scene 3 is excluded");
        assert_eq!(rep.scenes[0].logline, "Mara balances the books.");
        assert_eq!(rep.scenes[0].dual_pairs, 1);
        assert_eq!(rep.scenes[0].speakers, vec!["MARA VEY", "PELL"]);
        assert!(!rep.characters.iter().any(|c| c.name == "GHOST"), "omitted speaker excluded");

        let mara = rep.characters.iter().find(|c| c.name == "MARA VEY").unwrap();
        assert_eq!(mara.speeches, 2, "MARA and OLD MARA counted together via bible alias");
        assert_eq!(mara.words, 6);
        assert_eq!(mara.scenes, 2);
        assert_eq!(mara.dual_speeches, 1);

        let pell = rep.characters.iter().find(|c| c.name == "PELL").unwrap();
        assert_eq!(pell.speeches, 1);
        assert_eq!(pell.dual_speeches, 1);
        assert_eq!(pell.words, 2);

        // Action vs dialogue words and lines agree with scene rows (E8).
        let sum_aw: u64 = rep.action_dialogue.scenes.iter().map(|s| s.action_words).sum();
        let sum_dw: u64 = rep.action_dialogue.scenes.iter().map(|s| s.dialogue_words).sum();
        assert_eq!(rep.action_dialogue.action_words, sum_aw);
        assert_eq!(rep.action_dialogue.dialogue_words, sum_dw);
        assert_eq!(rep.action_dialogue.action_words, 10);
        assert_eq!(rep.action_dialogue.dialogue_words, 8);

        // Interior vs exterior and Day vs night agree with scene counts (E8).
        let ie_scenes: usize = rep.int_ext.iter().map(|r| r.scenes).sum();
        let dn_scenes: usize = rep.day_night.iter().map(|r| r.scenes).sum();
        assert_eq!(ie_scenes, rep.scenes.len());
        assert_eq!(dn_scenes, rep.scenes.len());

        // Revisions report shows changed pages and passages.
        assert_eq!(rep.revisions.len(), 1);
        assert_eq!(rep.revisions[0].changed_pages, 1);
        assert_eq!(rep.revisions[0].passages, 1);
        assert!(rep.revisions[0].active);

        // 2. Include omitted scenes: scene 3 and GHOST appear.
        let rep_incl = compute(
            std::slice::from_ref(&doc1),
            all_docs.clone(),
            &entities,
            ReportScope { mode: "document".into(), documents: vec!["ep1".into()], include_omitted: true },
            42,
            7,
        );
        assert_eq!(rep_incl.scenes.len(), 3);
        assert!(rep_incl.scenes[2].omitted);
        assert!(rep_incl.characters.iter().any(|c| c.name == "GHOST"));

        // 3. Whole-project scope merges HARBOUR and PIER via location alias and PELL across episodes.
        let rep_proj = compute(
            &[doc1, doc2],
            all_docs,
            &entities,
            ReportScope { mode: "project".into(), documents: vec!["ep1".into(), "ep2".into()], include_omitted: false },
            42,
            7,
        );
        assert_eq!(rep_proj.scenes.len(), 3);
        let harbour = rep_proj.locations.iter().find(|l| l.name == "HARBOUR").unwrap();
        assert_eq!(harbour.scenes, 2, "HARBOUR (ep1) and PIER (ep2) merged under bible entry");
        assert_eq!(harbour.first_document_id, "ep1");
        assert_eq!(harbour.last_document_id, "ep2");
    }

    #[test]
    fn tag_reports_distinguish_occurrences_from_scenes_and_characters_separate_speaking_silent_and_overlapping_participation() {
        let s1 = b(BlockKind::Heading, "INT. COUNTING HOUSE - NIGHT");
        let s1_id = s1.scene_id.clone().unwrap();
        let mut a1 = b(BlockKind::Action, "Mara opens the red ledger and checks the ledger again while Ines watches silently.");
        a1.id = "b_a1".into();

        let s2 = b(BlockKind::Heading, "EXT. HARBOUR WALL - DAWN");
        let s2_id = s2.scene_id.clone().unwrap();
        let mut a2 = b(BlockKind::Action, "Mara stands on the harbour wall with the red ledger.");
        a2.id = "b_a2".into();

        let mut dual_pell = b(BlockKind::Character, "PELL");
        dual_pell.dual = true;

        let doc1 = DocInput {
            id: "ep1".into(),
            title: "Episode 1".into(),
            profile: Profile::us_letter(),
            blocks: vec![
                s1,
                a1,
                b(BlockKind::Character, "MARA"),
                b(BlockKind::Dialogue, "Three hundred crowns."),
                dual_pell,
                b(BlockKind::Dialogue, "Count it twice."),
                s2,
                a2,
                b(BlockKind::Character, "TOBIAS (O.S.)"),
                b(BlockKind::Dialogue, "Drop the book."),
                b(BlockKind::Character, "OLD MARA (V.O.)"),
                b(BlockKind::Dialogue, "I never did."),
            ],
            beats: Vec::new(),
            numbers: Numbers::new(),
            page_lock: None,
            revision_sets: Vec::new(),
            active_revision: None,
            tags: vec![
                // E2: Red Ledger tagged twice in Scene 1 ("the red ledger" and "the ledger") and once in Scene 2.
                Tag {
                    id: "t1".into(),
                    document_id: "ep1".into(),
                    block_id: "b_a1".into(),
                    start: 11,
                    end: 25,
                    quote: "the red ledger".into(),
                    category: "props".into(),
                    entity_id: "e_ledger".into(),
                    note: "Hero prop".into(),
                    orphaned: false,
                },
                Tag {
                    id: "t2".into(),
                    document_id: "ep1".into(),
                    block_id: "b_a1".into(),
                    start: 37,
                    end: 47,
                    quote: "the ledger".into(),
                    category: "props".into(),
                    entity_id: "e_ledger".into(),
                    note: String::new(),
                    orphaned: false,
                },
                Tag {
                    id: "t3".into(),
                    document_id: "ep1".into(),
                    block_id: "b_a2".into(),
                    start: 37,
                    end: 51,
                    quote: "the red ledger".into(),
                    category: "props".into(),
                    entity_id: "e_ledger".into(),
                    note: "Weathered".into(),
                    orphaned: false,
                },
                // E6: Ines is tagged as `cast` in Scene 1 without speaking (silent presence).
                Tag {
                    id: "t4".into(),
                    document_id: "ep1".into(),
                    block_id: "b_a1".into(),
                    start: 60,
                    end: 64,
                    quote: "Ines".into(),
                    category: "cast".into(),
                    entity_id: "e_ines".into(),
                    note: "Silent observer".into(),
                    orphaned: false,
                },
            ],
        };

        let entities = vec![
            Entity {
                id: "e_mara".into(),
                kind: "character".into(),
                name: "Mara Vey".into(),
                aliases: vec!["MARA".into(), "OLD MARA".into()],
                ..Default::default()
            },
            Entity {
                id: "e_ines".into(),
                kind: "character".into(),
                name: "Ines".into(),
                aliases: Vec::new(),
                ..Default::default()
            },
            Entity {
                id: "e_ledger".into(),
                kind: "props".into(),
                name: "Red Ledger".into(),
                aliases: vec!["the red ledger".into(), "the ledger".into()],
                ..Default::default()
            },
        ];

        let rep = compute_with_tags(
            &[doc1],
            vec![ScopeDoc { id: "ep1".into(), title: "Episode 1".into() }],
            &entities,
            &[],
            ReportScope { mode: "document".into(), documents: vec!["ep1".into()], include_omitted: false },
            10,
            4,
        );

        // E1 & E2: Props report has 3 occurrences across 2 distinct scenes, with scene links.
        let props_rep = rep.tag_reports.iter().find(|r| r.category == "props").unwrap();
        assert_eq!(props_rep.total_occurrences, 3);
        assert_eq!(props_rep.distinct_scenes, 2);
        assert_eq!(props_rep.rows.len(), 1);
        let ledger = &props_rep.rows[0];
        assert_eq!(ledger.name, "Red Ledger");
        assert_eq!(ledger.occurrences, 3, "E2: 3 tag occurrences");
        assert_eq!(ledger.scenes, 2, "E2: 2 distinct scenes");
        assert_eq!(ledger.scene_links.len(), 2);
        assert_eq!(ledger.scene_links[0].scene_id, s1_id);
        assert_eq!(ledger.scene_links[0].occurrences, 2, "tagged twice in scene 1");
        assert_eq!(ledger.scene_links[1].scene_id, s2_id);
        assert_eq!(ledger.scene_links[1].occurrences, 1, "tagged once in scene 2");
        assert_eq!(ledger.notes, vec!["Hero prop", "Weathered"]);

        // E6: Speaking, V.O., O.S., dual dialogue, and silent presence remain distinct.
        let mara = rep.characters.iter().find(|c| c.name == "MARA VEY").unwrap();
        assert_eq!(mara.speeches, 2);
        assert_eq!(mara.vo_speeches, 1);
        assert_eq!(mara.os_speeches, 0);
        assert_eq!(mara.dual_speeches, 1);
        assert_eq!(mara.scenes, 2, "speaking scenes");
        assert_eq!(mara.silent_scenes, 0);
        assert_eq!(mara.total_scenes, 2);

        let tobias = rep.characters.iter().find(|c| c.name == "TOBIAS").unwrap();
        assert_eq!(tobias.speeches, 1);
        assert_eq!(tobias.os_speeches, 1);
        assert_eq!(tobias.vo_speeches, 0);
        assert_eq!(tobias.scenes, 1);
        assert_eq!(tobias.silent_scenes, 0);

        let ines = rep.characters.iter().find(|c| c.name == "INES").unwrap();
        assert_eq!(ines.speeches, 0, "Ines never speaks");
        assert_eq!(ines.scenes, 0, "0 speaking scenes");
        assert_eq!(ines.silent_scenes, 1, "1 silent scene from cast tag");
        assert_eq!(ines.total_scenes, 1);
        assert_eq!(ines.scene_links[0].role, "silent");

        // E7: Overlapping character participation eighths exceed total script eighths (not divided among cast or forced to 100%).
        let sum_char_eighths: u32 = rep.characters.iter().map(|c| c.participation_eighths).sum();
        assert!(
            sum_char_eighths > rep.total_eighths,
            "overlapping character participation ({sum_char_eighths}) exceeds total scene eighths ({})",
            rep.total_eighths
        );
    }
}
