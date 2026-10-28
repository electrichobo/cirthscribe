//! What the tabbed navigator shows (M3 step 3), derived from the script and
//! its page map, never stored: each scene's page and length in eighths and
//! the characters who speak in it; each character's speeches, words of
//! dialogue, scenes and first appearance, in one document or a whole project.
//!
//! Lengths are page eighths of the layout's own rows, labelled as estimates
//! in the UI. Characters are counted from their cues: a cue's extensions
//! ("(V.O.)", "(CONT'D)") and a dual-dialogue mark are not part of the name.
//! Dual dialogue counts each speaker's speech once.

use std::collections::HashMap;

use serde::Serialize;

use crate::layout::PageMap;
use crate::model::{Block, BlockKind, Id};

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct SceneStat {
    pub scene_id: Id,
    /// Printed label of the page the heading is on ("12", "12A").
    pub page: String,
    /// Length in eighths of a page (at least 1).
    pub eighths: u32,
    /// Where the scene starts, in pages from the top of the script (page 1
    /// starts at 0.0; halfway down page 3 is about 2.5). The pacing board
    /// reads it, with one page taken as about a minute (an estimate).
    pub position: f64,
    /// Speaking characters, in order of first speech.
    pub characters: Vec<String>,
}

/// A cue's character name: "MARA (V.O.)" -> "MARA", "INES (CONT'D)" -> "INES".
pub fn cue_name(cue: &str) -> String {
    let mut s = cue.trim().trim_end_matches('^').trim().to_string();
    while let Some(open) = s.rfind('(') {
        if !s.ends_with(')') {
            break;
        }
        s.truncate(open);
        s = s.trim_end().to_string();
    }
    s.to_uppercase()
}

/// Scenes in order, each with the ids of its blocks.
fn scene_blocks(blocks: &[Block]) -> Vec<(Id, Vec<&Block>)> {
    let mut out: Vec<(Id, Vec<&Block>)> = Vec::new();
    for b in blocks {
        if let (BlockKind::Heading, Some(sid)) = (b.kind, &b.scene_id) {
            out.push((sid.clone(), vec![b]));
        } else if let Some(last) = out.last_mut() {
            last.1.push(b);
        }
    }
    out
}

fn speakers(blocks: &[&Block]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for b in blocks {
        if b.kind == BlockKind::Character {
            let n = cue_name(&b.text());
            if !n.is_empty() && !out.contains(&n) {
                out.push(n);
            }
        }
    }
    out
}

/// Page and length of every scene, from the page map of the same blocks.
pub fn scene_stats(blocks: &[Block], map: &PageMap) -> Vec<SceneStat> {
    let scenes = scene_blocks(blocks);
    let mut scene_of: HashMap<&str, usize> = HashMap::new();
    for (i, (_, bs)) in scenes.iter().enumerate() {
        for b in bs {
            scene_of.insert(b.id.as_str(), i);
        }
    }
    // Rows each scene covers on each page (first to last of its lines).
    let mut rows = vec![0usize; scenes.len()];
    let mut page = vec![String::new(); scenes.len()];
    let mut position = vec![f64::NAN; scenes.len()];
    let body = map.body_lines.max(1) as f64;
    for (pi, p) in map.pages.iter().enumerate() {
        let mut span: HashMap<usize, (usize, usize)> = HashMap::new();
        for l in &p.lines {
            let Some(i) = l.block_id.as_deref().and_then(|id| scene_of.get(id)) else { continue };
            let e = span.entry(*i).or_insert((l.row, l.row));
            e.0 = e.0.min(l.row);
            e.1 = e.1.max(l.row);
            if page[*i].is_empty() {
                page[*i] = p.label.clone();
                position[*i] = pi as f64 + l.row as f64 / body;
            }
        }
        for (i, (a, b)) in span {
            rows[i] += b - a + 1;
        }
    }
    scenes
        .iter()
        .enumerate()
        .map(|(i, (sid, bs))| SceneStat {
            scene_id: sid.clone(),
            page: page[i].clone(),
            eighths: ((rows[i] as f64 / body * 8.0).round() as u32).max(1),
            position: if position[i].is_nan() { 0.0 } else { (position[i] * 100.0).round() / 100.0 },
            characters: speakers(bs),
        })
        .collect()
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Appearance {
    pub document_id: Id,
    pub scene_id: Id,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct CharacterStat {
    pub name: String,
    /// Speeches (cues) and the words spoken in them (dialogue and lyrics).
    pub speeches: u32,
    pub words: u64,
    /// Scenes they speak in, in script order; the first is their first appearance.
    pub scenes: Vec<Appearance>,
}

/// Speaking characters over one or more documents (in project order), most speeches first.
pub fn characters(documents: &[(Id, Vec<Block>)]) -> Vec<CharacterStat> {
    let mut by: Vec<CharacterStat> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    for (doc, blocks) in documents {
        for (sid, bs) in scene_blocks(blocks) {
            let mut speaker: Option<usize> = None;
            for b in bs {
                match b.kind {
                    BlockKind::Character => {
                        let n = cue_name(&b.text());
                        if n.is_empty() {
                            speaker = None;
                            continue;
                        }
                        let i = *index.entry(n.clone()).or_insert_with(|| {
                            by.push(CharacterStat { name: n, speeches: 0, words: 0, scenes: Vec::new() });
                            by.len() - 1
                        });
                        let c = &mut by[i];
                        c.speeches += 1;
                        if !c.scenes.iter().any(|a| a.scene_id == sid) {
                            c.scenes.push(Appearance { document_id: doc.clone(), scene_id: sid.clone() });
                        }
                        speaker = Some(i);
                    }
                    BlockKind::Dialogue | BlockKind::Lyric => {
                        if let Some(i) = speaker {
                            by[i].words += crate::words::count(&b.text());
                        }
                    }
                    BlockKind::Parenthetical => {}
                    _ => speaker = None,
                }
            }
        }
    }
    by.sort_by(|a, b| b.speeches.cmp(&a.speeches).then_with(|| a.name.cmp(&b.name)));
    by
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::layout::{Profile, paginate};

    fn b(kind: BlockKind, text: &str) -> Block {
        Block::new(kind, text)
    }

    #[test]
    fn cue_names_drop_extensions_and_the_dual_mark() {
        assert_eq!(cue_name("MARA (V.O.)"), "MARA");
        assert_eq!(cue_name("Ines (CONT'D) (O.S.)"), "INES");
        assert_eq!(cue_name("PELL ^"), "PELL");
        assert_eq!(cue_name("DR. ADA (INTO PHONE"), "DR. ADA (INTO PHONE", "an unclosed bracket is kept");
    }

    #[test]
    fn scenes_get_page_length_and_speakers_and_characters_their_counts() {
        let long = "word ".repeat(1500);
        let one = vec![
            b(BlockKind::Heading, "INT. HOUSE - DAY"),
            b(BlockKind::Character, "MARA"),
            b(BlockKind::Dialogue, "One two three."),
            b(BlockKind::Character, "PELL (V.O.)"),
            b(BlockKind::Parenthetical, "(quietly)"),
            b(BlockKind::Dialogue, "Four five."),
            b(BlockKind::Character, "MARA (CONT'D)"),
            b(BlockKind::Dialogue, "Six."),
            b(BlockKind::Heading, "EXT. SEA - NIGHT"),
            b(BlockKind::Action, &long),
        ];
        let map = paginate(&one, &Profile::us_letter(), 1);
        let st = scene_stats(&one, &map);
        assert_eq!(st.len(), 2);
        assert_eq!(st[0].page, "1");
        assert_eq!(st[0].characters, vec!["MARA", "PELL"]);
        assert!(st[0].eighths >= 1 && st[0].eighths <= 2, "a short scene: {}", st[0].eighths);
        assert!(st[1].eighths > 8, "a scene longer than a page: {}", st[1].eighths);
        assert!(st[1].characters.is_empty());
        assert_eq!(st[0].position, 0.0, "the first scene starts the script");
        assert!(st[1].position > 0.0 && st[1].position < 1.0, "the second starts on page 1: {}", st[1].position);

        let two = vec![b(BlockKind::Heading, "INT. BOAT - DAY"), b(BlockKind::Character, "PELL"), b(BlockKind::Dialogue, "Seven eight nine ten.")];
        let cs = characters(&[("ep1".into(), one.clone()), ("ep2".into(), two.clone())]);
        let mara = cs.iter().find(|c| c.name == "MARA").unwrap();
        let pell = cs.iter().find(|c| c.name == "PELL").unwrap();
        assert_eq!((mara.speeches, mara.words, mara.scenes.len()), (2, 4, 1));
        assert_eq!((pell.speeches, pell.words, pell.scenes.len()), (2, 6, 2), "across episodes");
        assert_eq!(pell.scenes[0].document_id, "ep1", "first appearance first");
        assert_eq!(pell.scenes[1].document_id, "ep2");
    }
}
