//! The story timeline (M3 step 8, ACCEPTANCE B5): what happens in the story's
//! own order, independent of the order the script shows it in.
//!
//! An event has a title, a summary, a free-form time ("Day 3, dawn", "1987",
//! "the night before"), may be uncertain, may happen at the same time as the
//! event before it, and links to any number of scenes in any script of the
//! project. Moving an event changes only the timeline; the script moves only
//! through a separate, previewed command (`chronological_order`).

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::model::Id;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
pub struct StoryEvent {
    pub id: Id,
    pub title: String,
    #[serde(default)]
    pub summary: String,
    /// When it happens, in the writer's words; relative times are fine.
    #[serde(default)]
    pub when: String,
    /// The time is a guess.
    #[serde(default)]
    pub uncertain: bool,
    /// Happens at the same time as the event before it.
    #[serde(default)]
    pub simultaneous: bool,
    /// Chronological order (lower first).
    pub pos: f64,
    /// Scenes that show it (stable scene ids, in any script).
    #[serde(default)]
    pub scenes: Vec<Id>,
}

/// Events in chronological order.
pub fn ordered(events: &[StoryEvent]) -> Vec<&StoryEvent> {
    let mut v: Vec<&StoryEvent> = events.iter().collect();
    v.sort_by(|a, b| a.pos.total_cmp(&b.pos).then(a.id.cmp(&b.id)));
    v
}

/// Events the script shows out of story order: an event whose first scene
/// comes after the first scene of a later event (a flashback), as event ids.
/// `script_index` gives each scene's place in reading order across the
/// project (episodes in tree order).
pub fn flashbacks(events: &[StoryEvent], script_index: &HashMap<Id, usize>) -> Vec<Id> {
    let shown: Vec<(&StoryEvent, Option<usize>)> = ordered(events).into_iter().map(|e| (e, e.scenes.iter().filter_map(|s| script_index.get(s)).min().copied())).collect();
    let mut out = Vec::new();
    for (i, (e, at)) in shown.iter().enumerate() {
        let Some(at) = at else { continue };
        if shown[i + 1..].iter().any(|(later, b)| !later.simultaneous && b.is_some_and(|b| b < *at)) {
            out.push(e.id.clone());
        }
    }
    out
}

/// A document's scenes put in story order: each scene goes where its
/// earliest event falls; a scene with no event stays right after the scene
/// it follows now (so a run of unlinked scenes moves with the scene before
/// it), and scenes before the first linked scene stay first.
pub fn chronological_order(events: &[StoryEvent], scenes: &[Id]) -> Vec<Id> {
    let rank: HashMap<&str, usize> = ordered(events).iter().enumerate().flat_map(|(i, e)| e.scenes.iter().map(move |s| (s.as_str(), i))).fold(HashMap::new(), |mut m, (s, i)| {
        m.entry(s).and_modify(|r: &mut usize| *r = (*r).min(i)).or_insert(i);
        m
    });
    // Groups: a linked scene and the unlinked scenes after it.
    let mut lead: Vec<Id> = Vec::new();
    let mut groups: Vec<(usize, usize, Vec<Id>)> = Vec::new();
    for (i, s) in scenes.iter().enumerate() {
        match rank.get(s.as_str()) {
            Some(r) => groups.push((*r, i, vec![s.clone()])),
            None => match groups.last_mut() {
                Some(g) => g.2.push(s.clone()),
                None => lead.push(s.clone()),
            },
        }
    }
    groups.sort_by_key(|g| (g.0, g.1));
    lead.into_iter().chain(groups.into_iter().flat_map(|g| g.2)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(id: &str, pos: f64, scenes: &[&str]) -> StoryEvent {
        StoryEvent { id: id.into(), title: id.into(), pos, scenes: scenes.iter().map(|s| s.to_string()).collect(), ..Default::default() }
    }

    #[test]
    fn a_flashback_is_an_event_shown_after_a_later_one() {
        // Script order: s1 s2 s3. Story: the childhood (shown in s3) comes first.
        let events = vec![ev("childhood", 0.0, &["s3"]), ev("storm", 1.0, &["s1"]), ev("rescue", 2.0, &["s2"])];
        let idx: HashMap<Id, usize> = [("s1", 0), ("s2", 1), ("s3", 2)].into_iter().map(|(k, v)| (k.to_string(), v)).collect();
        assert_eq!(flashbacks(&events, &idx), vec!["childhood".to_string()]);
        // Two events at the same moment are not flashbacks of each other, whichever the script shows first.
        let same = vec![ev("call", 0.0, &["s3"]), StoryEvent { simultaneous: true, ..ev("answer", 1.0, &["s1"]) }];
        assert!(flashbacks(&same, &idx).is_empty(), "{:?}", flashbacks(&same, &idx));
    }

    #[test]
    fn story_order_moves_linked_scenes_and_keeps_unlinked_ones_with_their_scene() {
        let events = vec![ev("a", 0.0, &["s4"]), ev("b", 1.0, &["s2"]), ev("c", 2.0, &["s2", "s5"])];
        // s1 (no event) first; s3 follows s2; s4 is the earliest event.
        let order = chronological_order(&events, &["s1", "s2", "s3", "s4", "s5"].map(String::from));
        assert_eq!(order, ["s1", "s4", "s2", "s3", "s5"].map(String::from));
        // Nothing linked: unchanged.
        assert_eq!(chronological_order(&[], &["x", "y"].map(String::from)), ["x", "y"].map(String::from));
    }
}
