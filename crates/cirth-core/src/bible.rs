//! The project bible (M3 step 7, ACCEPTANCE C1–C3): characters, locations
//! and world entries the writer keeps, with aliases and their own fields.
//!
//! Entries are authored: nothing here writes or deletes one. What is derived
//! from the scripts, and recomputed on every look, is:
//! - **candidates**: character names from cues and locations from scene
//!   headings that no entry or alias covers yet, each with its evidence
//!   (document, scene, block). Text in action lines is never a candidate, so
//!   an all-caps sound effect does not become a character (C1);
//! - **occurrences** of each entry (C2, C3: an entry with none is flagged as
//!   unreferenced, never deleted);
//! - **rename plans**: the cues or headings a rename would change, and the
//!   mentions in other text it leaves alone, shown before anything changes.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::model::{Block, BlockKind, Id, Run};
use crate::navigator::cue_name;

/// Built-in entry kinds in the project bible (M3 step 7 + M4 step 3 breakdown categories).
/// Writers can also add custom breakdown categories (`Store::tag_categories`).
pub const KINDS: [&str; 13] = [
    "character",
    "location",
    "world",
    "cast",
    "extras",
    "props",
    "costume",
    "vehicles",
    "sound",
    "vfx_sfx",
    "stunts",
    "makeup",
    "set_dressing",
];

/// Standard breakdown tag categories (M4 step 3).
pub const TAG_CATEGORIES: [(&str, &str); 10] = [
    ("cast", "Cast"),
    ("extras", "Extras"),
    ("props", "Props"),
    ("costume", "Costume"),
    ("vehicles", "Vehicles"),
    ("sound", "Sound"),
    ("vfx_sfx", "VFX / SFX"),
    ("stunts", "Stunts"),
    ("makeup", "Makeup"),
    ("set_dressing", "Set Dressing"),
];

pub fn valid_kind_key(kind: &str) -> bool {
    let k = kind.trim();
    !k.is_empty() && k.len() <= 40 && k.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
pub struct Entity {
    pub id: Id,
    /// "character", "location" or "world".
    pub kind: String,
    pub name: String,
    /// Other names the same entry goes by (a renamed character keeps its old name here).
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub description: String,
    /// The writer's own fields, in order (for example "Age" / "47").
    #[serde(default)]
    pub fields: Vec<(String, String)>,
    /// A folder (season) or document (episode) the entry belongs to; None for the whole project.
    #[serde(default)]
    pub scope: Option<Id>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Evidence {
    pub document_id: Id,
    pub scene_id: Option<Id>,
    pub block_id: Id,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Candidate {
    pub kind: String,
    pub name: String,
    pub count: usize,
    /// Where it was found (the first 50).
    pub evidence: Vec<Evidence>,
}

/// "INT. COUNTING HOUSE - NIGHT" -> "COUNTING HOUSE"; None when there is no place.
pub fn heading_location(heading: &str) -> Option<String> {
    let t = heading.trim();
    let upper = t.to_uppercase();
    let prefixes = ["INT./EXT.", "EXT./INT.", "INT/EXT", "I/E.", "I/E", "INT.", "EXT.", "EST.", "INT ", "EXT "];
    let rest = prefixes.iter().find_map(|p| upper.strip_prefix(p)).unwrap_or(&upper);
    let place = rest.split(" - ").next().unwrap_or("").trim().trim_start_matches('.').trim();
    (!place.is_empty()).then(|| place.to_string())
}

fn norm(s: &str) -> String {
    s.trim().to_uppercase()
}

/// Every cue name and heading location in the scripts, with where it is.
fn mentions(docs: &[(Id, Vec<Block>)]) -> Vec<(&'static str, String, Evidence)> {
    let mut out = Vec::new();
    for (doc, blocks) in docs {
        let mut scene: Option<Id> = None;
        for b in blocks {
            if b.kind == BlockKind::Heading {
                scene = b.scene_id.clone();
                if let Some(place) = heading_location(&b.text()) {
                    out.push(("location", place, Evidence { document_id: doc.clone(), scene_id: scene.clone(), block_id: b.id.clone() }));
                }
            } else if b.kind == BlockKind::Character {
                let n = cue_name(&b.text());
                if !n.is_empty() {
                    out.push(("character", n, Evidence { document_id: doc.clone(), scene_id: scene.clone(), block_id: b.id.clone() }));
                }
            }
        }
    }
    out
}

/// Candidates (names no entry covers, not rejected) and each entry's occurrences.
pub fn derive(entities: &[Entity], rejected: &HashSet<(String, String)>, docs: &[(Id, Vec<Block>)]) -> (Vec<Candidate>, HashMap<Id, Vec<Evidence>>) {
    derive_with_tags(entities, rejected, docs, &[])
}

/// Like `derive`, and also counts non-orphaned breakdown tags (`cirth_core::tags::Tag`)
/// as occurrences of their linked bible entry so tagged props, costumes, cast, etc.
/// show where they appear in the Bible dialog.
pub fn derive_with_tags(
    entities: &[Entity],
    rejected: &HashSet<(String, String)>,
    docs: &[(Id, Vec<Block>)],
    tags: &[crate::tags::Tag],
) -> (Vec<Candidate>, HashMap<Id, Vec<Evidence>>) {
    let mut owner: HashMap<(String, String), Id> = HashMap::new();
    for e in entities {
        for n in std::iter::once(&e.name).chain(e.aliases.iter()) {
            owner.entry((e.kind.clone(), norm(n))).or_insert_with(|| e.id.clone());
        }
    }
    let mut occ: HashMap<Id, Vec<Evidence>> = entities.iter().map(|e| (e.id.clone(), Vec::new())).collect();
    let mut cands: Vec<Candidate> = Vec::new();
    let mut at: HashMap<(String, String), usize> = HashMap::new();
    for (kind, name, ev) in mentions(docs) {
        let key = (kind.to_string(), norm(&name));
        if let Some(id) = owner.get(&key) {
            occ.get_mut(id).unwrap().push(ev);
        } else if !rejected.contains(&key) {
            let i = *at.entry(key).or_insert_with(|| {
                cands.push(Candidate { kind: kind.into(), name: name.clone(), count: 0, evidence: Vec::new() });
                cands.len() - 1
            });
            cands[i].count += 1;
            if cands[i].evidence.len() < 50 {
                cands[i].evidence.push(ev);
            }
        }
    }
    if !tags.is_empty() {
        let mut block_scene: HashMap<(Id, Id), Option<Id>> = HashMap::new();
        for (doc_id, blocks) in docs {
            let mut sc: Option<Id> = None;
            for b in blocks {
                if b.kind == BlockKind::Heading {
                    sc = b.scene_id.clone();
                }
                block_scene.insert((doc_id.clone(), b.id.clone()), sc.clone());
            }
        }
        for t in tags.iter().filter(|t| !t.orphaned) {
            if let Some(list) = occ.get_mut(&t.entity_id) {
                let scene_id = block_scene.get(&(t.document_id.clone(), t.block_id.clone())).cloned().flatten();
                list.push(Evidence { document_id: t.document_id.clone(), scene_id, block_id: t.block_id.clone() });
            }
        }
    }
    cands.sort_by(|a, b| a.kind.cmp(&b.kind).then(b.count.cmp(&a.count)).then(a.name.cmp(&b.name)));
    (cands, occ)
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RenameChange {
    pub document_id: Id,
    pub block_id: Id,
    pub before: String,
    pub after: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Mention {
    pub document_id: Id,
    pub block_id: Id,
    pub text: String,
}

/// What renaming would do: the cues (characters) or headings (locations) it
/// changes, and the other places the old name appears, which it leaves alone.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RenamePlan {
    pub changes: Vec<RenameChange>,
    pub untouched: Vec<Mention>,
}

/// Where `name` appears in `text` as a whole word, ignoring case (char indices).
fn find_word(text: &str, name: &str) -> Option<(usize, usize)> {
    let t: Vec<char> = text.chars().collect();
    let n: Vec<char> = name.chars().collect();
    if n.is_empty() || n.len() > t.len() {
        return None;
    }
    let word = |c: char| c.is_alphanumeric() || c == '\'';
    (0..=t.len() - n.len()).find_map(|i| {
        let hit = t[i..i + n.len()].iter().zip(&n).all(|(a, b)| a.to_lowercase().eq(b.to_lowercase()));
        let edges = (i == 0 || !word(t[i - 1])) && (i + n.len() == t.len() || !word(t[i + n.len()]));
        (hit && edges).then_some((i, i + n.len()))
    })
}

/// Replace chars [start, end) of the runs' text with `new`, keeping each run's marks.
pub fn replace_in_runs(runs: &[Run], start: usize, end: usize, new: &str) -> Vec<Run> {
    let mut out: Vec<Run> = Vec::new();
    let mut at = 0;
    let mut placed = false;
    for r in runs {
        let chars: Vec<char> = r.text.chars().collect();
        let (a, b) = (at, at + chars.len());
        at = b;
        let keep_before: String = chars[..start.clamp(a, b) - a].iter().collect();
        let keep_after: String = chars[end.clamp(a, b) - a..].iter().collect();
        let mut text = keep_before;
        if !placed && start >= a && start <= b {
            text.push_str(new);
            placed = true;
        }
        text.push_str(&keep_after);
        if !text.is_empty() {
            out.push(Run { text, ..r.clone() });
        }
    }
    if !placed {
        out.push(Run::plain(new));
    }
    out
}

/// Where the before and after texts of a rename differ: (start, end) in the
/// old text and the new name, so the runs' marks can be kept.
pub fn find_name(before: &str, after: &str) -> Option<(usize, usize, String)> {
    let b: Vec<char> = before.chars().collect();
    let a: Vec<char> = after.chars().collect();
    let pre = b.iter().zip(&a).take_while(|(x, y)| x == y).count();
    let suf = b[pre..].iter().rev().zip(a[pre..].iter().rev()).take_while(|(x, y)| x == y).count();
    Some((pre, b.len() - suf, a[pre..a.len() - suf].iter().collect()))
}

/// The rename of `entity` from `from` (its name or an alias) to `to`.
pub fn rename_plan(entity: &Entity, from: &str, to: &str, docs: &[(Id, Vec<Block>)]) -> RenamePlan {
    let mut changes = Vec::new();
    let mut untouched = Vec::new();
    let key = norm(from);
    let to = if entity.kind == "world" { to.trim().to_string() } else { to.trim().to_uppercase() };
    for (doc, blocks) in docs {
        for b in blocks {
            let text = b.text();
            let target = match (entity.kind.as_str(), b.kind) {
                ("character", BlockKind::Character) => norm(&cue_name(&text)) == key,
                ("location", BlockKind::Heading) => heading_location(&text).is_some_and(|p| norm(&p) == key),
                _ => false,
            };
            match find_word(&text, from) {
                Some((s, e)) if target => {
                    let runs = replace_in_runs(&b.runs, s, e, &to);
                    let after: String = runs.iter().map(|r| r.text.as_str()).collect();
                    changes.push(RenameChange { document_id: doc.clone(), block_id: b.id.clone(), before: text, after });
                }
                Some(_) => untouched.push(Mention { document_id: doc.clone(), block_id: b.id.clone(), text }),
                None => {}
            }
        }
    }
    RenamePlan { changes, untouched }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn b(kind: BlockKind, text: &str) -> Block {
        Block::new(kind, text)
    }

    #[test]
    fn headings_give_their_place() {
        assert_eq!(heading_location("INT. COUNTING HOUSE - NIGHT").as_deref(), Some("COUNTING HOUSE"));
        assert_eq!(heading_location("ext. weigh station - day").as_deref(), Some("WEIGH STATION"));
        assert_eq!(heading_location("INT./EXT. CAR - MOVING - DAY").as_deref(), Some("CAR"));
        assert_eq!(heading_location("INT. - NIGHT"), None);
    }

    #[test]
    fn candidates_come_from_cues_and_headings_only_with_evidence() {
        let doc = vec![
            b(BlockKind::Heading, "INT. HARBOUR - DAWN"),
            b(BlockKind::Action, "BANG! The DOOR slams. Mara runs."),
            b(BlockKind::Character, "MARA (V.O.)"),
            b(BlockKind::Dialogue, "Pell?"),
            b(BlockKind::Character, "PELL"),
            b(BlockKind::Dialogue, "Here."),
            b(BlockKind::Heading, "EXT. HARBOUR - DAY"),
            b(BlockKind::Character, "MARA"),
        ];
        let docs = vec![("ep1".to_string(), doc.clone())];
        let (c, occ) = derive(&[], &HashSet::new(), &docs);
        let names: Vec<(&str, &str, usize)> = c.iter().map(|x| (x.kind.as_str(), x.name.as_str(), x.count)).collect();
        assert_eq!(names, vec![("character", "MARA", 2), ("character", "PELL", 1), ("location", "HARBOUR", 2)]);
        assert!(!c.iter().any(|x| x.name == "BANG!" || x.name == "DOOR"), "action text never makes a candidate (C1)");
        assert_eq!(c[0].evidence[0].block_id, doc[2].id, "evidence points at the cue");
        assert!(occ.is_empty());

        // An entry with an alias covers both names; a rejected name stays away.
        let mara = Entity { id: "e1".into(), kind: "character".into(), name: "Mara Vey".into(), aliases: vec!["MARA".into()], ..Default::default() };
        let rejected: HashSet<(String, String)> = [("location".to_string(), "HARBOUR".to_string())].into();
        let (c, occ) = derive(&[mara], &rejected, &docs);
        assert_eq!(c.iter().map(|x| x.name.as_str()).collect::<Vec<_>>(), vec!["PELL"]);
        assert_eq!(occ["e1"].len(), 2);
    }

    #[test]
    fn rename_changes_cues_only_and_lists_other_mentions() {
        let doc = vec![
            b(BlockKind::Heading, "INT. HOUSE - DAY"),
            b(BlockKind::Action, "Mara looks at the sea. Maradona is on the radio."),
            b(BlockKind::Character, "MARA (CONT'D)"),
            b(BlockKind::Dialogue, "Pell, it's Mara."),
        ];
        let e = Entity { id: "e1".into(), kind: "character".into(), name: "MARA".into(), ..Default::default() };
        let p = rename_plan(&e, "MARA", "Ines", &[("d".into(), doc.clone())]);
        assert_eq!(p.changes.len(), 1);
        assert_eq!(p.changes[0].after, "INES (CONT'D)", "extensions kept, name in capitals");
        assert_eq!(p.untouched.iter().map(|m| m.block_id.clone()).collect::<Vec<_>>(), vec![doc[1].id.clone(), doc[3].id.clone()], "action and dialogue mentions are listed, not changed; Maradona is not a match");
        let runs = replace_in_runs(&[Run { bold: true, ..Run::plain("MARA (V.O.)") }], 0, 4, "INES");
        assert!(runs[0].bold && runs.iter().map(|r| r.text.clone()).collect::<String>() == "INES (V.O.)");
    }
}
