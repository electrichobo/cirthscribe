//! Spell checking: spellbook (Hunspell-compatible, pure Rust) with the SCOWL
//! "large" English dictionaries embedded in the binary (offline, nothing to
//! install). See docs/m1/spellcheck-options.md for the comparison.
//!
//! What is checked:
//! - Words are runs of letters (and combining marks) with internal
//!   apostrophes (' or ’) or hyphens. Curly apostrophes count as straight.
//! - Only Latin-script words are checked (the dictionaries are English);
//!   CJK, Hebrew, Arabic and other scripts are never marked.
//! - Words containing digits are skipped; so are words with combining marks
//!   (decomposed accents), which the dictionaries do not list.
//! - ALL-CAPS words (cues, headings) are also tried in lower and title case,
//!   so "HARBORMASTER'S" is fine when "harbormaster's" is.
//! - Hyphenated words are tried whole first; if that fails, each part is
//!   tried and only failing parts are marked.
//!
//! Ranges are UTF-16 offsets within the text, the units the editor uses.

use spellbook::Dictionary;
use std::collections::HashSet;

static US_AFF: &str = include_str!("../../../assets/dictionaries/en_US-large/en_US-large.aff");
static US_DIC: &str = include_str!("../../../assets/dictionaries/en_US-large/en_US-large.dic");
static GB_AFF: &str = include_str!("../../../assets/dictionaries/en_GB-large/en_GB-large.aff");
static GB_DIC: &str = include_str!("../../../assets/dictionaries/en_GB-large/en_GB-large.dic");

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lang {
    EnUs,
    EnGb,
}

impl Lang {
    pub fn parse(s: &str) -> Option<Lang> {
        match s {
            "en_US" => Some(Lang::EnUs),
            "en_GB" => Some(Lang::EnGb),
            _ => None,
        }
    }
    pub fn code(self) -> &'static str {
        match self {
            Lang::EnUs => "en_US",
            Lang::EnGb => "en_GB",
        }
    }
}

pub struct Speller {
    dict: Dictionary,
    lang: Lang,
    added: HashSet<String>,
    ignored: HashSet<String>,
}

fn is_apostrophe(c: char) -> bool {
    c == '\'' || c == '\u{2019}'
}

fn is_mark(c: char) -> bool {
    matches!(c as u32, 0x0300..=0x036F | 0x1AB0..=0x1AFF | 0x1DC0..=0x1DFF | 0x20D0..=0x20FF | 0xFE20..=0xFE2F)
}

fn is_latin_letter(c: char) -> bool {
    c.is_ascii_alphabetic() || (c.is_alphabetic() && matches!(c as u32, 0x00C0..=0x024F | 0x1E00..=0x1EFF))
}

/// A token's position in UTF-16 units, its text, and its char range.
struct Token {
    from: usize,
    to: usize,
    text: String,
}

/// Word-like tokens: letters (any script), marks and digits, joined by single
/// internal apostrophes or hyphens.
fn tokens(text: &str) -> Vec<Token> {
    let cs: Vec<(usize, char)> = {
        let mut u = 0;
        text.chars()
            .map(|c| {
                let at = u;
                u += c.len_utf16();
                (at, c)
            })
            .collect()
    };
    let wordish = |c: char| c.is_alphanumeric() || is_mark(c);
    let mut out = Vec::new();
    let mut i = 0;
    while i < cs.len() {
        if !wordish(cs[i].1) {
            i += 1;
            continue;
        }
        let start = i;
        while i < cs.len() {
            if wordish(cs[i].1) {
                i += 1;
            } else if (is_apostrophe(cs[i].1) || cs[i].1 == '-') && i + 1 < cs.len() && wordish(cs[i + 1].1) && wordish(cs[i - 1].1) {
                i += 1;
            } else {
                break;
            }
        }
        let to = if i < cs.len() { cs[i].0 } else { text.encode_utf16().count() };
        out.push(Token { from: cs[start].0, to, text: cs[start..i].iter().map(|(_, c)| *c).collect() });
    }
    out
}

fn checkable(word: &str) -> bool {
    word.chars().all(|c| is_latin_letter(c) || is_apostrophe(c) || c == '-') && word.chars().any(|c| c.is_alphabetic())
}

fn title_case(w: &str) -> String {
    let mut cs = w.chars();
    match cs.next() {
        Some(f) => f.to_uppercase().chain(cs.flat_map(|c| c.to_lowercase())).collect(),
        None => String::new(),
    }
}

impl Speller {
    pub fn new(lang: Lang) -> Speller {
        let (aff, dic) = match lang {
            Lang::EnUs => (US_AFF, US_DIC),
            Lang::EnGb => (GB_AFF, GB_DIC),
        };
        Speller { dict: Dictionary::new(aff, dic).expect("bundled dictionary parses"), lang, added: HashSet::new(), ignored: HashSet::new() }
    }

    pub fn lang(&self) -> Lang {
        self.lang
    }

    /// Accept `word` from now on (project or personal dictionary, cue names).
    /// Returns false for text that cannot be a dictionary word.
    pub fn add(&mut self, word: &str) -> bool {
        let w = word.trim().replace('\u{2019}', "'");
        if w.is_empty() || w.contains(['/', ' ', '\t', '\n']) || w.chars().count() > 64 {
            return false;
        }
        if self.added.insert(w.clone()) {
            let _ = self.dict.add(&w);
        }
        true
    }

    /// Accept `word` for this session only.
    pub fn ignore(&mut self, word: &str) {
        self.ignored.insert(word.replace('\u{2019}', "'").to_lowercase());
    }

    pub fn is_correct(&self, word: &str) -> bool {
        let w = word.replace('\u{2019}', "'");
        if !checkable(&w) || self.ignored.contains(&w.to_lowercase()) {
            return true;
        }
        if self.check_forms(&w) {
            return true;
        }
        // Possessive of a known word ("harbormaster's", "MARGIT'S").
        match w.strip_suffix("'s").or_else(|| w.strip_suffix("'S")) {
            Some(stem) if !stem.is_empty() => self.check_forms(stem),
            _ => false,
        }
    }

    /// The word as written, or for ALL-CAPS words also lower and title case.
    fn check_forms(&self, w: &str) -> bool {
        if self.dict.check(w) {
            return true;
        }
        let caps = w.chars().any(|c| c.is_alphabetic()) && !w.chars().any(|c| c.is_lowercase());
        caps && (self.dict.check(&w.to_lowercase()) || self.dict.check(&title_case(w)))
    }

    /// Misspelled ranges in `text`, UTF-16 offsets.
    pub fn misspelled(&self, text: &str) -> Vec<(usize, usize)> {
        let mut out = Vec::new();
        for t in tokens(text) {
            if t.text.chars().any(|c| c.is_numeric() || is_mark(c)) || !checkable(&t.text) || self.is_correct(&t.text) {
                continue;
            }
            if t.text.contains('-') {
                // Mark only the parts that are wrong.
                let mut at = t.from;
                for part in t.text.split('-') {
                    let len: usize = part.encode_utf16().count();
                    if !part.is_empty() && !self.is_correct(part) {
                        out.push((at, at + len));
                    }
                    at += len + 1;
                }
            } else {
                out.push((t.from, t.to));
            }
        }
        out
    }

    /// Up to 8 suggestions, in the word's own case style.
    pub fn suggest(&self, word: &str) -> Vec<String> {
        let w = word.replace('\u{2019}', "'");
        let caps = w.chars().any(|c| c.is_alphabetic()) && !w.chars().any(|c| c.is_lowercase());
        let mut s = Vec::new();
        let query = if caps { title_case(&w) } else { w.clone() };
        self.dict.suggest(&query, &mut s);
        if s.is_empty() && caps {
            self.dict.suggest(&w.to_lowercase(), &mut s);
        }
        let mut out: Vec<String> = Vec::new();
        for x in s {
            let x = if caps { x.to_uppercase() } else { x };
            if !out.contains(&x) {
                out.push(x);
            }
        }
        out.truncate(8);
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn marked(s: &Speller, text: &str) -> Vec<String> {
        let u: Vec<u16> = text.encode_utf16().collect();
        s.misspelled(text).into_iter().map(|(a, b)| String::from_utf16(&u[a..b]).unwrap()).collect()
    }

    #[test]
    fn us_and_uk_differ() {
        let us = Speller::new(Lang::EnUs);
        let gb = Speller::new(Lang::EnGb);
        assert_eq!(marked(&us, "The colour of the harbor; we realise."), vec!["colour", "realise"]);
        // The UK "large" list accepts -ize as well as -ise (Oxford spelling).
        assert_eq!(marked(&gb, "The color of the harbour; we realize, we realise."), vec!["color"]);
        assert!(us.suggest("recieve").contains(&"receive".to_string()));
    }

    #[test]
    fn caps_possessives_hyphens_and_apostrophes() {
        let s = Speller::new(Lang::EnUs);
        assert_eq!(marked(&s, "HARBORMASTER'S OFFICE - NIGHT"), Vec::<String>::new(), "all-caps forms and possessives");
        assert_eq!(marked(&s, "the teh's"), vec!["teh's"], "a possessive of an unknown word is still marked");
        assert!(marked(&s, "Don’t stop; it's well-known.").is_empty(), "curly apostrophes and valid compounds");
        assert_eq!(marked(&s, "a well-knwon fact"), vec!["knwon"], "only the wrong part of a compound");
        assert_eq!(s.suggest("RECIEVE")[0], "RECEIVE", "suggestions keep the case style");
    }

    #[test]
    fn other_scripts_numbers_and_marks_are_not_marked() {
        let s = Speller::new(Lang::EnUs);
        assert!(marked(&s, "日本語の台詞 שלום مرحبا 한국어 3rd 1,000 e\u{0301}cole 👍🏽").is_empty());
        assert!(marked(&s, "café naïve").is_empty());
    }

    #[test]
    fn offsets_are_utf16_after_emoji() {
        let s = Speller::new(Lang::EnUs);
        let text = "👍🏽 teh";
        assert_eq!(s.misspelled(text), vec![(5, 8)]);
    }

    #[test]
    fn added_and_ignored_words() {
        let mut s = Speller::new(Lang::EnUs);
        assert_eq!(marked(&s, "MARGIT meets Oyelaran"), vec!["MARGIT", "Oyelaran"]);
        assert!(s.add("Margit"));
        assert!(s.add("Oyelaran"));
        assert!(!s.add("two words"), "not a dictionary word");
        assert!(marked(&s, "MARGIT meets Oyelaran").is_empty());
        assert_eq!(marked(&s, "brûlée"), vec!["brûlée"]);
        s.ignore("Brûlée");
        assert!(marked(&s, "brûlée").is_empty(), "ignore is case-insensitive");
    }
}
