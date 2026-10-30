//! Original synthetic fixtures. All text here was written for this project;
//! the long script is assembled from these fragments by a seeded generator so
//! it is reproducible without storing a 120-page file by hand.

use crate::model::{Block, BlockKind, Document, Run};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct FixtureBlock {
    pub t: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub x: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runs: Option<Vec<Run>>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub dual: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub br: bool,
}

#[derive(Serialize, Deserialize)]
pub struct Fixture {
    pub title: String,
    pub note: String,
    pub blocks: Vec<FixtureBlock>,
}

impl Fixture {
    /// Fresh ids are assigned on import; fixtures never carry ids.
    pub fn to_document(&self) -> Result<Document, String> {
        let mut blocks = Vec::with_capacity(self.blocks.len());
        for fb in &self.blocks {
            let kind = BlockKind::parse(&fb.t).ok_or_else(|| format!("unknown block type {:?}", fb.t))?;
            let mut b = Block::new(kind, fb.x.clone());
            if let Some(r) = &fb.runs {
                b.runs = r.clone();
            }
            b.dual = fb.dual;
            b.break_before = fb.br;
            blocks.push(b);
        }
        Ok(Document { title: self.title.clone(), version: 0, blocks })
    }
}

fn fb(t: &str, x: impl Into<String>) -> FixtureBlock {
    FixtureBlock { t: t.into(), x: x.into(), runs: None, dual: false, br: false }
}

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        // xorshift64*
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545F4914F6CDD1D)
    }
    fn pick<'a>(&mut self, xs: &[&'a str]) -> &'a str {
        xs[(self.next() % xs.len() as u64) as usize]
    }
    fn range(&mut self, lo: usize, hi: usize) -> usize {
        lo + (self.next() % (hi - lo + 1) as u64) as usize
    }
}

const NAMES: &[&str] = &["MARGIT", "OYELARAN", "TOBIAS", "INES", "DECLAN", "SUNNIVA", "PELL", "ABENA", "RUFUS", "KAITO"];
const PLACES: &[&str] = &[
    "SALT MARSH WEIGH STATION",
    "HARBORMASTER'S OFFICE",
    "THE GLASSWORKS",
    "FERRY DECK",
    "SIGNAL TOWER",
    "NIGHT MARKET",
    "COOPERATIVE BAKERY",
    "ARCHIVE BASEMENT",
    "TRAIN YARD",
    "ROOFTOP GARDEN",
];
const TIMES: &[&str] = &["DAY", "NIGHT", "DAWN", "DUSK", "LATER", "CONTINUOUS"];
const ACTION: &[&str] = &[
    "Rain needles the corrugated roof.",
    "A ledger lies open, half its pages swollen with damp.",
    "Somewhere below, a winch groans and then gives up.",
    "The lamps flicker in sequence, as if counting.",
    "Gulls argue over a cracked crate of oranges.",
    "A kettle reaches the boil and nobody moves to lift it.",
    "Footprints in the flour lead to the back door and stop.",
    "The radio finds a station, loses it, finds a different one.",
    "Coils of rope have been stacked into a careful spiral.",
    "Chalk marks on the wall tally something nobody admits to counting.",
    "A bicycle bell rings twice from the street, then silence.",
    "The tide has left a line of glass beads along the step.",
];
const LINES: &[&str] = &[
    "You said the ferry would wait.",
    "It waited. Just not for us.",
    "I counted the crates twice and the second count was worse.",
    "Don't open that until the bell stops.",
    "Everyone in this town owes the bakery money, including the bakery.",
    "If the signal goes green, we leave. If it goes amber, we argue.",
    "I'm not angry. I'm keeping an accurate record.",
    "Tell me what the harbormaster actually said, not what you wish he'd said.",
    "The glass doesn't break if you warm it slowly.",
    "We have until the tide turns, and the tide never asks permission.",
    "That's the third time you've looked at the door.",
    "Fine. But I'm writing down that this was your idea.",
];
const PARENS: &[&str] = &["(quietly)", "(not looking up)", "(beat)", "(to Margit)", "(re: the ledger)", "(laughing despite herself)"];
const TRANSITIONS: &[&str] = &["CUT TO:", "SMASH CUT TO:", "DISSOLVE TO:"];

pub fn long_script(target_pages: usize) -> Fixture {
    let mut rng = Rng(0x00C1_7A5C_21BE_0001);
    let mut blocks = Vec::new();
    let mut scene = 0;
    loop {
        scene += 1;
        let ie = if rng.next() % 3 == 0 { "EXT." } else { "INT." };
        blocks.push(fb("heading", format!("{ie} {} - {}", rng.pick(PLACES), rng.pick(TIMES))));
        for _ in 0..rng.range(1, 3) {
            let s: Vec<&str> = (0..rng.range(1, 4)).map(|_| rng.pick(ACTION)).collect();
            blocks.push(fb("action", s.join(" ")));
        }
        for _ in 0..rng.range(3, 8) {
            let cue = rng.pick(NAMES);
            let mut cue_text = cue.to_string();
            if rng.next() % 11 == 0 {
                cue_text.push_str(" (V.O.)");
            }
            blocks.push(fb("character", cue_text));
            if rng.next() % 4 == 0 {
                blocks.push(fb("parenthetical", rng.pick(PARENS)));
            }
            let n = if rng.next() % 9 == 0 { rng.range(8, 16) } else { rng.range(1, 3) };
            let s: Vec<&str> = (0..n).map(|_| rng.pick(LINES)).collect();
            blocks.push(fb("dialogue", s.join(" ")));
            if rng.next() % 5 == 0 {
                blocks.push(fb("action", rng.pick(ACTION)));
            }
        }
        if rng.next() % 6 == 0 {
            blocks.push(fb("transition", rng.pick(TRANSITIONS)));
        }
        if scene % 10 == 0 {
            let f = Fixture { title: String::new(), note: String::new(), blocks: std::mem::take(&mut blocks) };
            let doc = f.to_document().unwrap();
            let pages = crate::layout::paginate(&doc.blocks, &crate::layout::Profile::us_letter(), 0).pages.len();
            blocks = f.blocks;
            if pages >= target_pages {
                break;
            }
        }
    }
    Fixture {
        title: "The Tide Ledger (synthetic long fixture)".into(),
        note: format!("Original synthetic text generated by cirth-cli gen-fixtures (seed 0x00C17A5C21BE0001, target {target_pages} pages, {scene} scenes). Not a real screenplay."),
        blocks,
    }
}

/// Words of exactly 9 letters plus a space wrap to 6 words (59 columns) per
/// 60-column action line, so line counts are predictable by hand.
pub fn action_lines(n: usize) -> String {
    let words = n * 6;
    (0..words).map(|i| format!("filler{:03}", i % 1000)).collect::<Vec<_>>().join(" ")
}

/// 35-column dialogue: "word word word. " patterns of known length.
pub fn dialogue_lines(n: usize) -> String {
    // "Sentence nn ends here." is 22 chars; with 3 words of filler per line the
    // count is not exact, so tests assert properties, not line numbers.
    (0..n * 2).map(|i| format!("Sentence {i:02} ends here.")).collect::<Vec<_>>().join(" ")
}

pub fn page_boundaries() -> Fixture {
    let mut b = Vec::new();
    // Page 1+: one speech long enough to cross several pages.
    b.push(fb("heading", "INT. COUNTING HOUSE - NIGHT"));
    b.push(fb("action", "INES has been talking for some time."));
    b.push(fb("character", "INES"));
    b.push(fb("dialogue", dialogue_lines(120)));
    // Case B: a cue and parenthetical would land at the page end. The whole
    // speech must move. Heading row 0, gap, 47 action lines rows 2-48, gap 49,
    // cue 50, paren 51, dialogue 52-55 (does not fit in 54 rows).
    let mut h = fb("heading", "INT. WEIGH STATION - DAY");
    h.br = true;
    b.push(h);
    b.push(fb("action", action_lines(47)));
    b.push(fb("character", "PELL"));
    b.push(fb("parenthetical", "(reading the dial)"));
    b.push(fb("dialogue", "Forty one. Forty one and a half. That can't be right, the scale was checked this morning by two people."));
    // Case D: heading keep-with-next. 50 action lines rows 0-49, gap 50,
    // heading would sit at 51 with its action at 53-54: does not fit.
    let mut a = fb("action", action_lines(50));
    a.br = true;
    b.push(a);
    b.push(fb("heading", "EXT. SIGNAL TOWER - CONTINUOUS"));
    b.push(fb("action", "The lamp turns amber. Then green. Then amber again, which is worse."));
    // Case E: dual dialogue near a page end moves as one unit.
    b.push(fb("action", action_lines(44)));
    b.push(fb("character", "MARGIT"));
    b.push(fb("dialogue", "We go now. The tide is already turning and I am not swimming after that ferry again."));
    let mut right = fb("character", "TOBIAS");
    right.dual = true;
    b.push(right);
    b.push(fb("dialogue", "We wait. The signal is amber, and amber means we argue first."));
    // Case F: long heading that wraps.
    b.push(fb(
        "heading",
        "INT. COOPERATIVE BAKERY - BACK ROOM BEHIND THE FLOUR STORE, WHERE THE OLD OVENS USED TO BE - NIGHT",
    ));
    b.push(fb("action", "Action after a wrapped heading."));
    b.push(fb("transition", "CUT TO:"));
    Fixture {
        title: "Page boundary cases".into(),
        note: "Original synthetic fixture for pagination rules: multi-page speech, cue/parenthetical at page end, heading keep-with-next, dual dialogue near page end, wrapped heading, explicit page breaks.".into(),
        blocks: b,
    }
}

pub fn unicode_marks() -> Fixture {
    let mut b = vec![
        fb("heading", "INT. CAFÉ NØRDLYS - DAY"),
        fb("action", "Zoë orders a crème brûlée; the naïve barista says “certainly” and means it. Ellipsis… em dash—here."),
        fb("character", "ZOË"),
        fb("dialogue", "Emoji survive: 👍🏽 🎬 👩‍👩‍👧. Combining: e\u{0301} (e + U+0301)."),
        fb("character", "KAITO"),
        fb("dialogue", "日本語の台詞もあります。漢字とかな。"),
        fb("character", "ABENA"),
        fb("dialogue", "Right-to-left sample: שלום and مرحبا, mixed with English."),
    ];
    b.push(FixtureBlock {
        t: "action".into(),
        x: String::new(),
        runs: Some(vec![
            Run::plain("Marks: "),
            Run { text: "bold".into(), bold: true, italic: false, underline: false, color: None, highlight: None, revision: None },
            Run::plain(", "),
            Run { text: "italic".into(), bold: false, italic: true, underline: false, color: None, highlight: None, revision: None },
            Run::plain(", "),
            Run { text: "underlined".into(), bold: false, italic: false, underline: true, color: None, highlight: None, revision: None },
            Run::plain(" and "),
            Run { text: "all three".into(), bold: true, italic: true, underline: true, color: None, highlight: None, revision: None },
            Run::plain("."),
        ]),
        dual: false,
        br: false,
    });
    Fixture {
        title: "Unicode and marks".into(),
        note: "Original synthetic fixture: accents, emoji ZWJ sequences, combining marks, CJK, RTL, inline marks. CJK, RTL and emoji are outside Courier Prime's coverage on purpose.".into(),
        blocks: b,
    }
}

pub fn uk_screenplay() -> Fixture {
    Fixture {
        title: "The Solway Firth (UK Screenplay)".into(),
        note: "Original synthetic fixture for UK/BBC screenplay formatting (A4 default, metric margins).".into(),
        blocks: vec![
            fb("heading", "EXT. SOLWAY FIRTH - DAWN"),
            fb("action", "Grey mist rolls off the Irish Sea. Cold water laps against the salt marshes."),
            fb("character", "ALISTAIR"),
            fb("dialogue", "The tide is coming in faster than the timetable honours."),
            fb("character", "FIONA"),
            fb("dialogue", "Then we should take the causeway before the signals turn red."),
        ],
    }
}

pub fn multicam_teleplay() -> Fixture {
    Fixture {
        title: "Apartment 4B (Multi-Camera Teleplay)".into(),
        note: "Original synthetic fixture for TV multi-camera sitcoms (lettered scenes, uppercase dialogue).".into(),
        blocks: vec![
            fb("heading", "SCENE A - INT. LIVING ROOM - NIGHT"),
            fb("action", "MARCUS and CHLOE unpack groceries onto the crowded counter."),
            fb("character", "MARCUS"),
            fb("dialogue", "DID YOU REMEMBER THE CILANTRO OR ARE WE DESTINED FOR BLAND GUACAMOLE?"),
            fb("character", "CHLOE"),
            fb("parenthetical", "(holding up a bundle of parsley)"),
            fb("dialogue", "DEPENDS ON HOW CONFIDENT YOU FEEL ABOUT BOTANY."),
        ],
    }
}

pub fn theatrical_stageplay() -> Fixture {
    Fixture {
        title: "The Glassmaker of Murano (Stage Play)".into(),
        note: "Original synthetic fixture for theatrical stage plays (Act/Scene headings, bracketed stage directions).".into(),
        blocks: vec![
            fb("heading", "ACT I, SCENE 1"),
            fb("action", "At rise: A 16th-century furnace glows dull orange stage right. Glassblowing pipes and iron pontils lean against brick."),
            fb("character", "ELENA"),
            fb("parenthetical", "(examining the pontil)"),
            fb("dialogue", "The silica must remain pure. Any salt from the lagoon clouds the crystal."),
            fb("character", "GIACOMO"),
            fb("dialogue", "The Council of Ten cares only that the secret never crosses the water."),
        ],
    }
}

pub fn comic_script() -> Fixture {
    Fixture {
        title: "Signal Flare: Issue 1 (Comic Script)".into(),
        note: "Original synthetic fixture for comic book scripting (pages, panels, balloons, captions, SFX).".into(),
        blocks: vec![
            fb("heading", "PAGE ONE (4 Panels)"),
            fb("shot", "PANEL 1"),
            fb("action", "Wide establishing shot of the sea wall under driving rain. A single lantern swings in the wind."),
            fb("character", "CAPTION"),
            fb("dialogue", "Low tide brings the scavengers. High tide brings the truth."),
            fb("shot", "PANEL 2"),
            fb("action", "Close up on a leather glove prying open a bronze valve."),
            fb("character", "SFX"),
            fb("dialogue", "KR-R-RACK!"),
            fb("shot", "PANEL 3"),
            fb("action", "A hooded figure looks over her shoulder toward the beacon."),
            fb("character", "MIRA"),
            fb("dialogue", "Almost through. Keep your eyes on the road."),
            fb("shot", "PANEL 4"),
            fb("action", "A motorcycle headlight cuts through the rain in the far distance."),
            fb("character", "CAPTION"),
            fb("dialogue", "Too late."),
        ],
    }
}

pub fn interactive_story() -> Fixture {
    Fixture {
        title: "The Sunken Citadel (Interactive Story)".into(),
        note: "Original synthetic fixture for interactive branching stories (passages, choices, conditions).".into(),
        blocks: vec![
            fb("heading", "Start"),
            fb("action", "You stand before the obsidian archway of the Sunken Citadel. Sea foam coats the mossy flagstones.\n\n[[Enter through the Grand Portico -> Portico]]\n[[Scramble along the Sea Wall -> SeaWall]]"),
            fb("heading", "Portico"),
            fb("action", "Massive bronze doors hang half-open, encrusted with barnacles. A glowing pedestal stands in the foyer.\n\n[[Inspect the pedestal -> Pedestal]]\n[[Return to the entrance -> Start]]"),
            fb("heading", "SeaWall"),
            fb("action", "Salt spray blinds you as waves batter the rocky footing. You spot a narrow drainage conduit leading inward.\n\n[[Crawl through the conduit -> CitadelDepths]]\n[[Return to the entrance -> Start]]"),
            fb("heading", "Pedestal"),
            fb("action", "A silver ring rests in a pool of clear water atop the marble pedestal.\n\n[[Take the ring and proceed -> CitadelDepths [if ring_taken]]]\n[[Leave the ring and turn back -> Portico]]"),
            fb("heading", "CitadelDepths"),
            fb("action", "You reach the heart of the ancient citadel. Bioluminescent coral illuminates the submerged throne room.\n\n[THE END]"),
        ],
    }
}

pub fn series_treatment() -> Fixture {
    Fixture {
        title: "The Tide Ledger: Series Bible & Treatment".into(),
        note: "Original synthetic fixture for series treatments and pitch bibles (H1-H3 hierarchy, character spotlights).".into(),
        blocks: vec![
            fb("heading", "THE TIDE LEDGER"),
            fb("action", "A six-part dramatic series examining memory, trade, and betrayal in a declining maritime borough."),
            fb("section", "SERIES LOGLINE"),
            fb("action", "When an unrecorded cargo manifests in a quarantined salt marsh, a disgraced harbormaster must choose between clearing his family name or preserving the fragile truce that keeps the harbor alive."),
            fb("section", "CENTRAL CHARACTERS"),
            fb("character", "MARGIT VANCE"),
            fb("action", "A stubborn municipal ledger-keeper who measures morality in metric tons."),
            fb("character", "TOBIAS PELL"),
            fb("action", "A retired ferry pilot with an encyclopedic memory of sandbar movements."),
            fb("section", "SEASON ONE OVERVIEW"),
            fb("action", "Episode 1 begins with the arrival of the empty barge. Over the course of twelve days, tidal anomalies reveal long-buried structural fraud in the harbor foundations."),
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_fixtures_generate_valid_documents() {
        for f in [
            uk_screenplay(),
            multicam_teleplay(),
            theatrical_stageplay(),
            comic_script(),
            interactive_story(),
            series_treatment(),
        ] {
            let doc = f.to_document().expect("fixture converts to document");
            assert!(!doc.blocks.is_empty(), "fixture {} has blocks", f.title);
        }
    }

    #[test]
    fn test_comic_fixture_analysis() {
        let f = comic_script();
        let doc = f.to_document().unwrap();
        let analysis = crate::comic::parse_comic_script(&doc.blocks);
        assert_eq!(analysis.total_pages, 1);
        assert_eq!(analysis.total_panels, 4);
        assert_eq!(analysis.total_balloons, 1);
        assert_eq!(analysis.total_captions, 2);
        assert_eq!(analysis.total_sfx, 1);
    }

    #[test]
    fn test_interactive_fixture_validation() {
        let f = interactive_story();
        let doc = f.to_document().unwrap();
        let graph = crate::interactive::parse_interactive_script(&doc.blocks, &f.title);
        assert_eq!(graph.total_passages, 5);
        assert_eq!(graph.total_choices, 8);
        assert!(graph.validation.is_valid);
    }

    #[test]
    fn test_treatment_fixture_parsing() {
        let f = series_treatment();
        let doc = f.to_document().unwrap();
        let treatment = crate::treatment::parse_treatment_doc(&doc.blocks, &f.title, None, &[]);
        assert!(treatment.total_headings >= 1);
        assert!(treatment.total_paragraphs >= 4);
    }
}
