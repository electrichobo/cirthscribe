//! Scene numbers. Unlocked scripts have none (numbers are not shown until the
//! writer locks them). Locking numbers the scenes 1..N in script order; while
//! locked, numbers never change, and a scene added later takes one from the
//! scene before it: after 12 comes 12A, then 12B; between 12A and 12B comes
//! 12AA; before the first scene comes A1, then B1. Numbers are stored by the
//! heading's stable scene id (store.rs, table scene_numbers), so editing,
//! moving or undoing a scene never renumbers it.
//!
//! An omitted scene keeps its number and prints as "OMITTED"; its text stays
//! in the project and comes back with Restore.

use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct SceneNumber {
    pub scene_id: String,
    pub number: String,
    pub omitted: bool,
}

/// Numbers keyed by scene id, as the layout and the UI use them.
pub type Numbers = HashMap<String, SceneNumber>;

fn split(n: &str) -> (&str, &str) {
    // "12AB" -> ("12", "AB"); "A1" -> ("A1", "") (a leading letter is a prefix).
    let digits_end = n.rfind(|c: char| c.is_ascii_digit()).map(|i| i + 1).unwrap_or(0);
    (&n[..digits_end], &n[digits_end..])
}

fn succ(letters: &str) -> Option<String> {
    // Next suffix at the same length: "A" -> "B", "AZ" -> None (append instead).
    let mut cs: Vec<char> = letters.chars().collect();
    let last = cs.last_mut()?;
    if *last >= 'Z' {
        return None;
    }
    *last = char::from_u32(*last as u32 + 1)?;
    Some(cs.into_iter().collect())
}

/// The number for a scene added after `prev` (None: before every numbered
/// scene, which starts at `first`). Never returns a number in `used`.
pub fn number_after(prev: Option<&str>, first: Option<&str>, used: &HashSet<String>) -> String {
    match prev {
        None => {
            // A1, B1, … before the first numbered scene.
            let base = first.map(|f| split(f).0.trim_start_matches(|c: char| c.is_ascii_alphabetic()).to_string()).filter(|b| !b.is_empty()).unwrap_or_else(|| "1".into());
            for c in 'A'..='Z' {
                let n = format!("{c}{base}");
                if !used.contains(&n) {
                    return n;
                }
            }
            let mut n = format!("A{base}");
            while used.contains(&n) {
                n.insert(0, 'A');
            }
            n
        }
        Some(prev) => {
            let (base, letters) = split(prev);
            // Same length first (12 -> 12A, 12A -> 12B), then one letter longer (12AA).
            let mut candidate = if letters.is_empty() { format!("{base}A") } else { succ(letters).map(|l| format!("{base}{l}")).unwrap_or_else(|| format!("{prev}A")) };
            if used.contains(&candidate) {
                candidate = format!("{prev}A");
                while used.contains(&candidate) {
                    let (b, l) = split(&candidate);
                    candidate = succ(l).map(|l| format!("{b}{l}")).unwrap_or_else(|| format!("{candidate}A"));
                }
            }
            candidate
        }
    }
}

/// Give every scene in `order` (scene ids in script order) that has no number
/// one from its neighbours. Returns the new (scene id, number) pairs.
pub fn assign_missing(order: &[String], numbers: &Numbers) -> Vec<(String, String)> {
    let mut used: HashSet<String> = numbers.values().map(|n| n.number.clone()).collect();
    let first = order.iter().find_map(|id| numbers.get(id)).map(|n| n.number.clone());
    let mut prev: Option<String> = None;
    let mut out = Vec::new();
    for id in order {
        if let Some(n) = numbers.get(id) {
            prev = Some(n.number.clone());
            continue;
        }
        let n = number_after(prev.as_deref(), first.as_deref(), &used);
        used.insert(n.clone());
        out.push((id.clone(), n.clone()));
        prev = Some(n);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn used(ns: &[&str]) -> HashSet<String> {
        ns.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn inserted_scenes_take_letters_from_the_scene_before() {
        let u = used(&["1", "12", "13"]);
        assert_eq!(number_after(Some("12"), Some("1"), &u), "12A");
        assert_eq!(number_after(Some("12A"), Some("1"), &used(&["12", "12A", "13"])), "12B");
        // Between 12A and 12B: 12AA.
        assert_eq!(number_after(Some("12A"), Some("1"), &used(&["12", "12A", "12B", "13"])), "12AA");
        assert_eq!(number_after(Some("12AA"), Some("1"), &used(&["12A", "12AA", "12B"])), "12AB");
        // Before the first scene: A1, B1.
        assert_eq!(number_after(None, Some("1"), &used(&["1"])), "A1");
        assert_eq!(number_after(None, Some("1"), &used(&["1", "A1"])), "B1");
        // After Z: one letter longer.
        assert_eq!(number_after(Some("12Z"), Some("1"), &used(&["12Z"])), "12ZA");
    }

    #[test]
    fn assigning_keeps_existing_numbers_and_fills_the_gaps() {
        let mut numbers = Numbers::new();
        for (id, n) in [("a", "1"), ("b", "2"), ("c", "3")] {
            numbers.insert(id.into(), SceneNumber { scene_id: id.into(), number: n.into(), omitted: false });
        }
        let order: Vec<String> = ["new0", "a", "b", "new1", "new2", "c", "new3"].iter().map(|s| s.to_string()).collect();
        let got = assign_missing(&order, &numbers);
        assert_eq!(got, vec![("new0".into(), "A1".into()), ("new1".into(), "2A".into()), ("new2".into(), "2B".into()), ("new3".into(), "3A".into())]);
    }
}
