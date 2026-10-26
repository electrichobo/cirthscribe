//! The one word-count rule, used by the editor (live counts) and reports.
//!
//! A word is a run of letters, digits and combining marks, which may contain
//! a single apostrophe (' or ’) or hyphen between word characters ("don't",
//! "well-known", "co-op's"), and a single comma or point between digits
//! ("1,000", "3.5"). Everything else separates words: spaces, other
//! punctuation (including "--" and dashes), and emoji, which are not words.
//! Each Chinese or Japanese character (Han, Hiragana, Katakana) counts as one
//! word; Korean is written with spaces and follows the general rule. An
//! empty block has no words.
//!
//! Cases: `fixtures/word-count-cases.json` (tested below).

use crate::model::{BlockKind, Document};
use serde::Serialize;
use std::collections::BTreeMap;

fn is_cjk(c: char) -> bool {
    matches!(c as u32,
        0x3040..=0x309F      // Hiragana
        | 0x30A0..=0x30FF    // Katakana
        | 0x31F0..=0x31FF    // Katakana phonetic extensions
        | 0x3400..=0x4DBF    // CJK extension A
        | 0x4E00..=0x9FFF    // CJK unified ideographs
        | 0xF900..=0xFAFF    // CJK compatibility ideographs
        | 0xFF66..=0xFF9F    // half-width Katakana
        | 0x20000..=0x2FA1F) // CJK extensions B and later
}

fn is_mark(c: char) -> bool {
    matches!(c as u32, 0x0300..=0x036F | 0x1AB0..=0x1AFF | 0x1DC0..=0x1DFF | 0x20D0..=0x20FF | 0xFE20..=0xFE2F)
}

fn is_word_char(c: char) -> bool {
    !is_cjk(c) && (c.is_alphanumeric() || is_mark(c))
}

pub fn count(text: &str) -> u64 {
    let cs: Vec<char> = text.chars().collect();
    let mut n = 0;
    let mut i = 0;
    while i < cs.len() {
        let c = cs[i];
        if is_cjk(c) {
            n += 1;
            i += 1;
        } else if is_word_char(c) {
            n += 1;
            i += 1;
            loop {
                while i < cs.len() && is_word_char(cs[i]) {
                    i += 1;
                }
                let next_is_word = i + 1 < cs.len() && is_word_char(cs[i + 1]);
                let joins = i < cs.len()
                    && next_is_word
                    && (matches!(cs[i], '\'' | '\u{2019}' | '-')
                        || (matches!(cs[i], '.' | ',') && cs[i - 1].is_numeric() && cs[i + 1].is_numeric()));
                if !joins {
                    break;
                }
                i += 1;
            }
        } else {
            i += 1;
        }
    }
    n
}

#[derive(Clone, Debug, Serialize, Default)]
pub struct DocumentCounts {
    pub total: u64,
    /// Words per block type (kind name -> words).
    pub by_kind: BTreeMap<&'static str, u64>,
    pub blocks: usize,
    pub doc_version: u64,
}

pub fn document(doc: &Document) -> DocumentCounts {
    let mut out = DocumentCounts { blocks: doc.blocks.len(), doc_version: doc.version, ..Default::default() };
    for k in BlockKind::ALL {
        out.by_kind.insert(k.as_str(), 0);
    }
    for b in &doc.blocks {
        let n = count(&b.text());
        out.total += n;
        *out.by_kind.get_mut(b.kind.as_str()).unwrap() += n;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(serde::Deserialize)]
    struct Case {
        text: String,
        words: u64,
        why: String,
    }

    #[test]
    fn shared_cases() {
        let cases: Vec<Case> = serde_json::from_str(include_str!("../../../fixtures/word-count-cases.json")).unwrap();
        assert!(cases.len() >= 20);
        for c in cases {
            assert_eq!(count(&c.text), c.words, "{:?}: {}", c.text, c.why);
        }
    }

    #[test]
    fn document_totals_are_the_sum_of_blocks() {
        let doc = crate::fixtures::long_script(10).to_document().unwrap();
        let d = document(&doc);
        let sum: u64 = doc.blocks.iter().map(|b| count(&b.text())).sum();
        assert_eq!(d.total, sum);
        assert_eq!(d.by_kind.values().sum::<u64>(), sum);
        assert!(d.by_kind["dialogue"] > 0 && d.by_kind["action"] > 0);
    }
}
