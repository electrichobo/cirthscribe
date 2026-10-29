// Character sides: for one or more chosen characters, export the scenes
// they appear in, as pages for actors and auditions (M4 step 6; ROADMAP §M4).
//
// Invariants (ROADMAP, PRODUCT_SPEC §6):
// - Options: their scenes only (ScenesOnly), or full pages with the other
//   scenes struck through (CrossOut).
// - Each scene keeps its locked scene numbers and page labels from the
//   baseline pagination.
// - A dual-dialogue pair stays whole when either speaker's sides are made.
// - Built on the production PDF (Courier Prime 12pt, OFL, zero new dependencies).

use std::collections::{HashMap, HashSet};
use std::io::{BufWriter, Cursor};
use std::path::Path;

use printpdf::*;
use serde::{Deserialize, Serialize};

use crate::layout::Profile;
use crate::model::{BlockKind, Document, Id};
use crate::navigator::cue_name;
use crate::pdf::{fix_info_strings, id32, mm, page_mm, BOLD, BOLD_ITALIC, ITALIC, REGULAR};
use crate::store::Store;

fn default_true() -> bool {
    true
}

/// Mode for character sides presentation.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SidesMode {
    /// Only lines of scenes containing the character(s) are printed on the qualifying pages.
    ScenesOnly,
    /// Full pages printed, but scenes NOT containing the character(s) are visually crossed out.
    CrossOut,
}

impl Default for SidesMode {
    fn default() -> Self {
        SidesMode::ScenesOnly
    }
}

/// Options configuring character sides generation.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SidesOptions {
    #[serde(default)]
    pub document_id: Option<Id>,
    pub characters: Vec<String>,
    #[serde(default)]
    pub mode: SidesMode,
    #[serde(default = "default_true")]
    pub include_title_page: bool,
    #[serde(default)]
    pub all_pages: bool,
    #[serde(default)]
    pub watermark: Option<String>,
    #[serde(default)]
    pub custom_header: Option<String>,
}

/// A character reference available for sides export.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SidesCharacter {
    pub name: String,
    pub speeches: u32,
    pub scenes: usize,
    pub has_dual: bool,
}

/// Result metadata from a sides export.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SidesExportResult {
    pub path: String,
    pub pages: usize,
    pub scenes_included: usize,
    pub characters: Vec<String>,
    pub mode: String,
    pub bytes: usize,
}

/// Return all speaking characters in the document, sorted by speech count descending.
pub fn list_characters(store: &Store, doc_id: &str) -> Result<Vec<SidesCharacter>, String> {
    let doc = store.load_document(doc_id).map_err(|e| e.to_string())?;
    let bible = store.entities().unwrap_or_default();
    let mut aliases: HashMap<String, String> = HashMap::new();
    for e in bible {
        let canon = e.name.trim().to_uppercase();
        if canon.is_empty() {
            continue;
        }
        for a in e.aliases {
            let atrim = a.trim().to_uppercase();
            if !atrim.is_empty() {
                aliases.insert(atrim, canon.clone());
            }
        }
    }

    struct CharAcc {
        speeches: u32,
        scenes: HashSet<String>,
        has_dual: bool,
    }

    let mut map: HashMap<String, CharAcc> = HashMap::new();
    let mut current_scene: Option<String> = None;
    let mut last_speaker: Option<String> = None;

    for b in &doc.blocks {
        if b.kind == BlockKind::Heading {
            current_scene = b.scene_id.clone().or_else(|| Some(b.id.clone()));
            last_speaker = None;
        } else if b.kind == BlockKind::Character {
            let cue = cue_name(&b.text());
            if cue.is_empty() {
                continue;
            }
            let canon = aliases.get(&cue).cloned().unwrap_or(cue);
            if b.dual {
                if let Some(prev) = &last_speaker {
                    if let Some(prev_entry) = map.get_mut(prev) {
                        prev_entry.has_dual = true;
                    }
                }
            }
            let entry = map.entry(canon.clone()).or_insert_with(|| CharAcc {
                speeches: 0,
                scenes: HashSet::new(),
                has_dual: false,
            });
            entry.speeches += 1;
            if b.dual {
                entry.has_dual = true;
            }
            if let Some(sid) = &current_scene {
                entry.scenes.insert(sid.clone());
            }
            last_speaker = Some(canon);
        }
    }

    let mut out: Vec<SidesCharacter> = map
        .into_iter()
        .map(|(name, acc)| SidesCharacter {
            name,
            speeches: acc.speeches,
            scenes: acc.scenes.len(),
            has_dual: acc.has_dual,
        })
        .collect();

    out.sort_by(|a, b| b.speeches.cmp(&a.speeches).then_with(|| a.name.cmp(&b.name)));
    Ok(out)
}

/// Internal scene inspection for character sides qualification.
struct SceneInfo {
    scene_id: Id,
    scene_number: String,
    block_ids: HashSet<Id>,
    characters: HashSet<String>,
    dual_pairs: Vec<(String, String)>,
}

/// Analyze document blocks and identify qualifying scenes and protected dual pairs.
fn analyze_scenes(
    doc: &Document,
    doc_id: &str,
    store: &Store,
    selected_canon: &HashSet<String>,
) -> (HashSet<Id>, HashSet<Id>, Vec<String>, usize) {
    let bible = store.entities().unwrap_or_default();
    let mut alias_to_canon: HashMap<String, String> = HashMap::new();
    for e in bible {
        let canon = e.name.trim().to_uppercase();
        if canon.is_empty() {
            continue;
        }
        for a in e.aliases {
            let atrim = a.trim().to_uppercase();
            if !atrim.is_empty() {
                alias_to_canon.insert(atrim, canon.clone());
            }
        }
    }
    let canon_of = |s: &str| -> String {
        let up = s.trim().to_uppercase();
        alias_to_canon.get(&up).cloned().unwrap_or(up)
    };

    let tags = store.tags_of(doc_id).unwrap_or_default();
    let mut cast_tags_by_scene: HashMap<String, HashSet<String>> = HashMap::new();
    for t in tags {
        if t.category == "cast" && !t.orphaned {
            let ent_name = canon_of(&t.quote);
            if !ent_name.is_empty() {
                if let Some(b) = doc.blocks.iter().find(|b| b.id == t.block_id) {
                    if let Some(sid) = &b.scene_id {
                        cast_tags_by_scene.entry(sid.clone()).or_default().insert(ent_name);
                    }
                }
            }
        }
    }

    let numbers = store.scene_numbers(doc_id).unwrap_or_default();
    let mut scenes: Vec<SceneInfo> = Vec::new();
    let mut current: Option<SceneInfo> = None;
    let mut last_speaker: Option<String> = None;

    let mut scene_counter = 0usize;
    for b in &doc.blocks {
        if b.kind == BlockKind::Heading {
            if let Some(sc) = current.take() {
                scenes.push(sc);
            }
            scene_counter += 1;
            let sid = b.scene_id.clone().unwrap_or_else(|| b.id.clone());
            let snum = numbers.get(&sid).map(|n| n.number.clone()).unwrap_or_else(|| scene_counter.to_string());
            let mut sc = SceneInfo {
                scene_id: sid.clone(),
                scene_number: snum,
                block_ids: HashSet::new(),
                characters: HashSet::new(),
                dual_pairs: Vec::new(),
            };
            sc.block_ids.insert(b.id.clone());
            if let Some(cast) = cast_tags_by_scene.get(&sid) {
                sc.characters.extend(cast.iter().cloned());
            }
            current = Some(sc);
            last_speaker = None;
        } else if let Some(sc) = &mut current {
            sc.block_ids.insert(b.id.clone());
            if b.kind == BlockKind::Character {
                let cue = cue_name(&b.text());
                if !cue.is_empty() {
                    let canon = canon_of(&cue);
                    sc.characters.insert(canon.clone());
                    if b.dual {
                        if let Some(prev) = last_speaker.take() {
                            sc.dual_pairs.push((prev, canon.clone()));
                        }
                    }
                    last_speaker = Some(canon);
                }
            }
        }
    }
    if let Some(sc) = current.take() {
        scenes.push(sc);
    }

    let mut qualifying_scene_ids: HashSet<Id> = HashSet::new();
    let mut qualifying_block_ids: HashSet<Id> = HashSet::new();
    let mut included_scene_numbers: Vec<String> = Vec::new();

    for sc in scenes {
        // A scene qualifies if any selected character speaks in it, is tagged in cast,
        // or is part of a dual dialogue pair in that scene (ROADMAP §M4).
        let qualifies = sc.characters.iter().any(|c| selected_canon.contains(c))
            || sc.dual_pairs.iter().any(|(a, b)| selected_canon.contains(a) || selected_canon.contains(b));

        if qualifies {
            qualifying_scene_ids.insert(sc.scene_id.clone());
            qualifying_block_ids.extend(sc.block_ids);
            if !included_scene_numbers.contains(&sc.scene_number) {
                included_scene_numbers.push(sc.scene_number);
            }
        }
    }

    let total_scenes = qualifying_scene_ids.len();
    (qualifying_scene_ids, qualifying_block_ids, included_scene_numbers, total_scenes)
}

/// Generate character sides PDF bytes.
pub fn generate_sides(
    store: &Store,
    doc_id: &str,
    opts: &SidesOptions,
    p: &Profile,
    date_unix: i64,
) -> Result<Vec<u8>, String> {
    let doc = store.load_document(doc_id).map_err(|e| e.to_string())?;
    let selected_canon: HashSet<String> = opts.characters.iter().map(|c| c.trim().to_uppercase()).filter(|s| !s.is_empty()).collect();
    if selected_canon.is_empty() {
        return Err("At least one character must be selected for character sides".into());
    }

    let (_qual_scene_ids, qual_block_ids, scene_numbers, total_scenes) =
        analyze_scenes(&doc, doc_id, store, &selected_canon);

    // Baseline production pagination with locked numbers and page locks
    let lock = store.page_lock(doc_id).map_err(|e| e.to_string())?;
    let numbers = store.scene_numbers(doc_id).unwrap_or_default();
    let base_map = crate::layout::paginate_production(&doc.blocks, p, doc.version, &numbers, lock.as_ref());

    // Filter pages
    struct PageRenderInfo<'a> {
        page: &'a crate::layout::Page,
        _has_qualifying: bool,
    }

    let mut page_infos: Vec<PageRenderInfo> = Vec::new();
    for page in &base_map.pages {
        let has_qualifying = page.lines.iter().any(|l| {
            l.block_id.as_ref().is_some_and(|bid| qual_block_ids.contains(bid))
        });
        if has_qualifying || (opts.mode == SidesMode::CrossOut && opts.all_pages) {
            page_infos.push(PageRenderInfo { page, _has_qualifying: has_qualifying });
        }
    }

    // PDF initialization
    let date = printpdf::OffsetDateTime::from_unix_timestamp(date_unix).map_err(|e| e.to_string())?;
    let doc_id_str = id32(&store.project_id().unwrap_or_else(|_| "sides".into()));
    let chars_title = opts.characters.join(", ");
    let (pdf_doc, page1, layer1) = PdfDocument::new(
        format!("Sides - {}", chars_title).as_str(),
        page_mm(p.page_w_in),
        page_mm(p.page_h_in),
        "text",
    );
    let pdf_doc = pdf_doc
        .with_author("Kolbítar")
        .with_subject(format!("Character Sides: {}", chars_title).as_str())
        .with_creator("Kolbítar")
        .with_producer("Kolbítar")
        .with_document_id(doc_id_str.clone())
        .with_creation_date(date)
        .with_mod_date(date)
        .with_metadata_date(date);

    let load = |b: &[u8]| pdf_doc.add_external_font(Cursor::new(b.to_vec())).map_err(|e| e.to_string());
    let fonts: [IndirectFontRef; 4] = [load(REGULAR)?, load(BOLD)?, load(ITALIC)?, load(BOLD_ITALIC)?];
    let line_in = 1.0 / p.lines_per_inch;
    let baseline = |row: usize| p.page_h_in - p.top_in - (row as f32) * line_in - 0.8 * line_in;
    let char_in = 1.0 / p.chars_per_inch;

    let mut first = Some((page1, layer1));
    let mut next_page = || first.take().unwrap_or_else(|| pdf_doc.add_page(page_mm(p.page_w_in), page_mm(p.page_h_in), "text"));

    // Title page
    if opts.include_title_page {
        let tp = store.title_page(doc_id).unwrap_or_default();
        let (pi, li) = next_page();
        let layer = pdf_doc.get_page(pi).get_layer(li);

        if !tp.is_empty() {
            for l in crate::title::layout(&tp, p) {
                layer.use_text(l.text, p.font_pt, mm(l.x_in), mm(baseline(l.row)), &fonts[0]);
            }
        } else {
            // Default header if title page was empty
            layer.use_text(doc.title.clone(), p.font_pt + 2.0, mm(p.action.left_in), mm(p.page_h_in - 2.5), &fonts[1]);
        }

        // Prominent SIDES banner at bottom half of title page
        let banner_top = p.page_h_in - 6.5;
        let left = p.action.left_in;
        layer.use_text("CHARACTER SIDES", p.font_pt + 2.0, mm(left), mm(banner_top), &fonts[1]);
        layer.use_text(format!("CHARACTER(S): {}", chars_title), p.font_pt, mm(left), mm(banner_top - 0.35), &fonts[0]);
        let sc_str = if scene_numbers.is_empty() { "None".into() } else { scene_numbers.join(", ") };
        layer.use_text(format!("SCENES ({}): {}", total_scenes, sc_str), p.font_pt, mm(left), mm(banner_top - 0.70), &fonts[0]);
        let mode_str = match opts.mode {
            SidesMode::ScenesOnly => "Format: Active scenes only",
            SidesMode::CrossOut => "Format: Full pages (other scenes struck through)",
        };
        layer.use_text(mode_str, p.font_pt - 1.0, mm(left), mm(banner_top - 1.05), &fonts[2]);
    }

    // Script pages
    let top_y = p.page_h_in - 0.5 - 0.8 * line_in;
    let sides_header = opts.custom_header.clone().unwrap_or_else(|| format!("SIDES: {}", chars_title));

    for pinfo in &page_infos {
        let page = pinfo.page;
        let (pi, li) = next_page();
        let layer = pdf_doc.get_page(pi).get_layer(li);

        // Header: "SIDES: <CHARACTERS>" on left, page label on right
        let head_w = unicode_width::UnicodeWidthStr::width(sides_header.as_str()) as f32 * char_in;
        layer.use_text(sides_header.clone(), p.font_pt, mm(p.action.left_in), mm(top_y), &fonts[1]);

        let label = format!("{}.", page.label);
        let x_label = p.page_w_in - 1.0 - label.chars().count() as f32 * char_in;
        layer.use_text(label, p.font_pt, mm(x_label), mm(top_y), &fonts[0]);

        // Watermark if provided
        if let Some(wm) = &opts.watermark {
            if !wm.trim().is_empty() {
                layer.set_outline_color(Color::Rgb(Rgb::new(0.85, 0.85, 0.85, None)));
                layer.use_text(wm.trim(), p.font_pt - 2.0, mm(p.action.left_in + head_w + 0.4), mm(top_y), &fonts[2]);
            }
        }

        // Collect non-qualifying line ranges on this page for cross-out diagonal lines
        let mut non_qual_ranges: Vec<(f32, f32)> = Vec::new();
        let mut current_range: Option<(f32, f32)> = None;

        for l in &page.lines {
            // Determine if this line belongs to a qualifying scene
            let is_qualifying = if let Some(bid) = &l.block_id {
                qual_block_ids.contains(bid)
            } else if l.kind == "scene-number" {
                // Scene number on margin: keep if any qualifying heading exists on this row
                page.lines.iter().any(|other| {
                    other.row == l.row && other.kind == "heading" && other.block_id.as_ref().is_some_and(|bid| qual_block_ids.contains(bid))
                })
            } else {
                // Synthetic continuation line: check previous line on page
                true
            };

            if opts.mode == SidesMode::ScenesOnly {
                if !is_qualifying {
                    continue;
                }
            }

            let y = baseline(l.row);

            // In CrossOut mode: track vertical range of non-qualifying blocks and strike through text
            if opts.mode == SidesMode::CrossOut && !is_qualifying && l.kind != "scene-number" {
                let y_top = y + 0.12;
                let y_bottom = y - 0.04;
                match &mut current_range {
                    Some(range) => {
                        range.1 = y_bottom; // extend downward
                    }
                    None => {
                        current_range = Some((y_top, y_bottom));
                    }
                }
            } else if opts.mode == SidesMode::CrossOut && is_qualifying {
                if let Some(range) = current_range.take() {
                    non_qual_ranges.push(range);
                }
            }

            // Draw line text
            let mut x = l.x_in;
            for s in &l.segs {
                let f = &fonts[(s.bold as usize) | ((s.italic as usize) << 1)];
                let w = unicode_width::UnicodeWidthStr::width(s.text.as_str()) as f32 * char_in;
                if !s.text.is_empty() {
                    layer.use_text(s.text.clone(), p.font_pt, mm(x), mm(y), f);
                }

                // If non-qualifying in CrossOut mode, strike through each text segment
                if opts.mode == SidesMode::CrossOut && !is_qualifying && w > 0.0 {
                    layer.set_outline_thickness(0.7);
                    layer.set_outline_color(Color::Rgb(Rgb::new(0.35, 0.35, 0.35, None)));
                    layer.add_line(Line {
                        points: vec![
                            (Point::new(mm(x), mm(y + 0.04)), false),
                            (Point::new(mm(x + w), mm(y + 0.04)), false),
                        ],
                        is_closed: false,
                    });
                }

                if s.underline && w > 0.0 && is_qualifying {
                    layer.set_outline_thickness(0.6);
                    layer.add_line(Line {
                        points: vec![
                            (Point::new(mm(x), mm(y - 0.03)), false),
                            (Point::new(mm(x + w), mm(y - 0.03)), false),
                        ],
                        is_closed: false,
                    });
                }
                x += w;
            }
        }

        if let Some(range) = current_range.take() {
            non_qual_ranges.push(range);
        }

        // Draw diagonal cross-out lines across non-qualifying blocks (CrossOut mode)
        if opts.mode == SidesMode::CrossOut {
            layer.set_outline_thickness(0.7);
            layer.set_outline_color(Color::Rgb(Rgb::new(0.5, 0.5, 0.5, None)));
            let left_x = p.action.left_in;
            let right_x = (p.action.left_in + (p.action.width_ch as f32 * char_in)).min(p.page_w_in - 1.0);

            for (y_top, y_bottom) in non_qual_ranges {
                if (y_top - y_bottom).abs() > 0.05 {
                    // Diagonal line from top-left to bottom-right
                    layer.add_line(Line {
                        points: vec![
                            (Point::new(mm(left_x), mm(y_top)), false),
                            (Point::new(mm(right_x), mm(y_bottom)), false),
                        ],
                        is_closed: false,
                    });
                    // Opposite diagonal from top-right to bottom-left
                    layer.add_line(Line {
                        points: vec![
                            (Point::new(mm(right_x), mm(y_top)), false),
                            (Point::new(mm(left_x), mm(y_bottom)), false),
                        ],
                        is_closed: false,
                    });
                }
            }
        }
    }

    let mut out = BufWriter::new(Vec::new());
    pdf_doc.save(&mut out).map_err(|e| e.to_string())?;
    let bytes = out.into_inner().map_err(|e| e.to_string())?;
    Ok(fix_info_strings(bytes))
}

/// Export character sides to a file path.
pub fn export_sides(
    store: &Store,
    doc_id: &str,
    opts: &SidesOptions,
    profile: &Profile,
    target_path: &Path,
    date_unix: i64,
) -> Result<SidesExportResult, String> {
    let bytes = generate_sides(store, doc_id, opts, profile, date_unix)?;
    let tmp = target_path.with_extension("pdf.tmp");
    std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
    crate::fsutil::sync_file(&tmp).map_err(|e| e.to_string())?;
    crate::fsutil::replace_file(&tmp, target_path).map_err(|e| e.to_string())?;

    let doc = store.load_document(doc_id).map_err(|e| e.to_string())?;
    let selected_canon: HashSet<String> = opts.characters.iter().map(|c| c.trim().to_uppercase()).filter(|s| !s.is_empty()).collect();
    let (_, _, _, total_scenes) = analyze_scenes(&doc, doc_id, store, &selected_canon);

    // Count pages from the generated PDF
    let page_count = bytes.windows(7).filter(|&w| w == b"/Page\n" || w == b"/Page\r" || w == b"/Page ").count().max(1);

    Ok(SidesExportResult {
        path: target_path.display().to_string(),
        pages: page_count,
        scenes_included: total_scenes,
        characters: opts.characters.clone(),
        mode: match opts.mode {
            SidesMode::ScenesOnly => "scenes_only".into(),
            SidesMode::CrossOut => "cross_out".into(),
        },
        bytes: bytes.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fixtures::Fixture;

    fn tmpdir(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("cirth-sides-test-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn seed_fixture(store: &mut Store, fixture_name: &str) -> Document {
        let src = match fixture_name {
            "page-boundaries" => include_str!("../../../fixtures/page-boundaries.json"),
            _ => panic!("unknown fixture"),
        };
        let fx: Fixture = serde_json::from_str(src).unwrap();
        let doc = fx.to_document().unwrap();
        store.seed(&doc).unwrap();
        doc
    }

    #[test]
    fn list_characters_finds_speakers_and_dual_status() {
        let d = tmpdir("list_chars");
        let mut store = Store::open(&d.join("w.db")).unwrap();
        let _doc = seed_fixture(&mut store, "page-boundaries");
        let doc_id = store.current_document().unwrap();

        let chars = list_characters(&store, &doc_id).unwrap();
        assert!(!chars.is_empty());
        let ines = chars.iter().find(|c| c.name == "INES").unwrap();
        let pell = chars.iter().find(|c| c.name == "PELL").unwrap();
        let margit = chars.iter().find(|c| c.name == "MARGIT").unwrap();
        let tobias = chars.iter().find(|c| c.name == "TOBIAS").unwrap();
        assert_eq!(ines.speeches, 1);
        assert_eq!(pell.speeches, 1);
        assert!(margit.has_dual, "MARGIT participates in dual dialogue");
        assert!(tobias.has_dual, "TOBIAS participates in dual dialogue");
    }

    #[test]
    fn sides_scenes_only_and_cross_out_modes_generate_valid_pdf() {
        let d = tmpdir("sides_modes");
        let mut store = Store::open(&d.join("w.db")).unwrap();
        let _ = seed_fixture(&mut store, "page-boundaries");
        let doc_id = store.current_document().unwrap();
        let prof = Profile::us_letter();

        // 1. ScenesOnly mode
        let opts_scenes = SidesOptions {
            document_id: Some(doc_id.clone()),
            characters: vec!["INES".into()],
            mode: SidesMode::ScenesOnly,
            include_title_page: true,
            all_pages: false,
            watermark: Some("AUDITION COPY".into()),
            custom_header: None,
        };
        let pdf_scenes = generate_sides(&store, &doc_id, &opts_scenes, &prof, 1700000000).unwrap();
        assert!(pdf_scenes.starts_with(b"%PDF"));
        assert!(pdf_scenes.len() > 1000);

        // 2. CrossOut mode
        let opts_cross = SidesOptions {
            document_id: Some(doc_id.clone()),
            characters: vec!["INES".into()],
            mode: SidesMode::CrossOut,
            include_title_page: true,
            all_pages: false,
            watermark: None,
            custom_header: None,
        };
        let pdf_cross = generate_sides(&store, &doc_id, &opts_cross, &prof, 1700000000).unwrap();
        assert!(pdf_cross.starts_with(b"%PDF"));
        assert!(pdf_cross.len() > 1000);
    }

    #[test]
    fn dual_dialogue_pair_qualifies_scene_and_preserves_both_speakers() {
        let d = tmpdir("dual_dialogue");
        let mut store = Store::open(&d.join("w.db")).unwrap();
        let doc = seed_fixture(&mut store, "page-boundaries");
        let doc_id = store.current_document().unwrap();

        let mut sel_margit = HashSet::new();
        sel_margit.insert("MARGIT".into());
        let (qual_scenes_margit, qual_blocks_margit, _, _) = analyze_scenes(&doc, &doc_id, &store, &sel_margit);

        let mut sel_tobias = HashSet::new();
        sel_tobias.insert("TOBIAS".into());
        let (qual_scenes_tobias, qual_blocks_tobias, _, _) = analyze_scenes(&doc, &doc_id, &store, &sel_tobias);

        // When MARGIT or TOBIAS is chosen, both qualify the exact same dual scene and block set
        assert!(!qual_scenes_margit.is_empty(), "MARGIT qualifies scene");
        assert_eq!(qual_scenes_margit, qual_scenes_tobias, "Both speakers in dual dialogue qualify the scene");
        assert_eq!(qual_blocks_margit, qual_blocks_tobias, "Both halves of dual dialogue remain in the block set");
    }
}
