//! Canonical screenplay document model.
//!
//! A document is one ordered sequence of typed blocks. A scene starts at a
//! scene-heading block and runs to the next heading; its identity is the
//! `scene_id` carried by that heading, never its position or number.
//! Blocks before the first heading belong to no scene (a cold open fragment,
//! title notes and the like).

use serde::{Deserialize, Serialize};

pub type Id = String;

pub fn new_id() -> Id {
    uuid::Uuid::new_v4().to_string()
}

/// Document format and profile conventions (M6, ROADMAP M6).
///
/// Controls layout geometry, default paper size, indentation rules, and
/// format-specific structural semantics.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DocumentProfile {
    ScreenplayUs,
    ScreenplayUk,
    TeleplayMultiCam,
    StagePlay,
    ComicScript,
    InteractiveStory,
    TreatmentProse,
}

impl DocumentProfile {
    pub const ALL: [DocumentProfile; 7] = [
        DocumentProfile::ScreenplayUs,
        DocumentProfile::ScreenplayUk,
        DocumentProfile::TeleplayMultiCam,
        DocumentProfile::StagePlay,
        DocumentProfile::ComicScript,
        DocumentProfile::InteractiveStory,
        DocumentProfile::TreatmentProse,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            DocumentProfile::ScreenplayUs => "screenplay_us",
            DocumentProfile::ScreenplayUk => "screenplay_uk",
            DocumentProfile::TeleplayMultiCam => "teleplay_multicam",
            DocumentProfile::StagePlay => "stageplay",
            DocumentProfile::ComicScript => "comic",
            DocumentProfile::InteractiveStory => "interactive",
            DocumentProfile::TreatmentProse => "treatment",
        }
    }

    pub fn parse(s: &str) -> Option<DocumentProfile> {
        match s.to_ascii_lowercase().replace('-', "_").as_str() {
            "screenplay_us" | "screenplay" | "us_letter" => Some(DocumentProfile::ScreenplayUs),
            "screenplay_uk" | "a4" | "uk" => Some(DocumentProfile::ScreenplayUk),
            "teleplay_multicam" | "multicam" | "sitcom" => Some(DocumentProfile::TeleplayMultiCam),
            "stageplay" | "stage_play" | "theatre" | "theater" => Some(DocumentProfile::StagePlay),
            "comic" | "comic_script" | "graphic_novel" => Some(DocumentProfile::ComicScript),
            "interactive" | "interactive_story" | "branching" => Some(DocumentProfile::InteractiveStory),
            "treatment" | "treatment_prose" | "prose" => Some(DocumentProfile::TreatmentProse),
            _ => None,
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            DocumentProfile::ScreenplayUs => "Screenplay (US Feature)",
            DocumentProfile::ScreenplayUk => "Screenplay (UK / BBC)",
            DocumentProfile::TeleplayMultiCam => "Teleplay (Multi-Camera Sitcom)",
            DocumentProfile::StagePlay => "Stage Play (Theatrical)",
            DocumentProfile::ComicScript => "Comic Book / Graphic Novel",
            DocumentProfile::InteractiveStory => "Interactive Branching Story",
            DocumentProfile::TreatmentProse => "Treatment / Prose",
        }
    }

    /// Default page size profile for this document profile.
    pub fn default_page_size(self) -> &'static str {
        match self {
            DocumentProfile::ScreenplayUk => "a4",
            _ => "us-letter",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlockKind {
    Heading,
    Action,
    Character,
    Parenthetical,
    Dialogue,
    Transition,
    Shot,
    Section,
    Lyric,
}

impl BlockKind {
    pub const ALL: [BlockKind; 9] = [
        BlockKind::Heading,
        BlockKind::Action,
        BlockKind::Character,
        BlockKind::Parenthetical,
        BlockKind::Dialogue,
        BlockKind::Transition,
        BlockKind::Shot,
        BlockKind::Section,
        BlockKind::Lyric,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            BlockKind::Heading => "heading",
            BlockKind::Action => "action",
            BlockKind::Character => "character",
            BlockKind::Parenthetical => "parenthetical",
            BlockKind::Dialogue => "dialogue",
            BlockKind::Transition => "transition",
            BlockKind::Shot => "shot",
            BlockKind::Section => "section",
            BlockKind::Lyric => "lyric",
        }
    }

    pub fn parse(s: &str) -> Option<BlockKind> {
        BlockKind::ALL.into_iter().find(|k| k.as_str() == s)
    }

    /// Part of a speech: cue, parenthetical, dialogue, lyric.
    pub fn is_speech(self) -> bool {
        matches!(
            self,
            BlockKind::Character | BlockKind::Parenthetical | BlockKind::Dialogue | BlockKind::Lyric
        )
    }
}

/// A run of text with uniform inline marks. Storing runs instead of mark
/// offsets keeps persisted data free of any offset unit.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Run {
    pub text: String,
    #[serde(default, skip_serializing_if = "is_false")]
    pub bold: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub italic: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub underline: bool,
    /// Writer's markup, on screen only (owner decision 2026-10-27): a palette
    /// name such as "red". Never printed or exported; the page layout does
    /// not read it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Writer's highlight, on screen only, like `color`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub highlight: Option<String>,
    /// Revision set (revisions.rs) this text was added or changed in while
    /// revision mode was on. Printed as a margin mark on its lines.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision: Option<String>,
}

fn is_false(b: &bool) -> bool {
    !*b
}

impl Run {
    pub fn plain(text: impl Into<String>) -> Run {
        Run { text: text.into(), bold: false, italic: false, underline: false, color: None, highlight: None, revision: None }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Block {
    pub id: Id,
    pub kind: BlockKind,
    pub runs: Vec<Run>,
    /// Present only on heading blocks.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scene_id: Option<Id>,
    /// On a character cue: this speech is the right column of a dual-dialogue
    /// pair with the speech just before it.
    #[serde(default, skip_serializing_if = "is_false")]
    pub dual: bool,
    /// Forced page break before this block.
    #[serde(default, skip_serializing_if = "is_false")]
    pub break_before: bool,
}

impl Block {
    pub fn new(kind: BlockKind, text: impl Into<String>) -> Block {
        Block {
            id: new_id(),
            kind,
            runs: vec![Run::plain(text)],
            scene_id: if kind == BlockKind::Heading { Some(new_id()) } else { None },
            dual: false,
            break_before: false,
        }
    }

    pub fn text(&self) -> String {
        self.runs.iter().map(|r| r.text.as_str()).collect()
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Document {
    pub title: String,
    pub version: u64,
    pub blocks: Vec<Block>,
}

/// A planning beat. Its summary is authored text, never derived from or
/// written into the script. It may link to one scene by stable id.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Beat {
    pub id: Id,
    /// One authored line saying what the scene is about (cards show it above
    /// the summary). Empty until the writer fills it in.
    #[serde(default)]
    pub logline: String,
    pub summary: String,
    pub scene_id: Option<Id>,
    /// Planning order among its outline siblings; independent of script order.
    pub pos: f64,
    /// Outline item kind (M3 step 4, decision B: beats are outline items):
    /// "act", "sequence" or "beat". Only beats show on the board.
    #[serde(default = "beat_kind")]
    pub kind: String,
    /// Title of an act or sequence (a beat's own line is its logline).
    #[serde(default)]
    pub title: String,
    /// The act or sequence it sits in; None at the top of the outline.
    #[serde(default)]
    pub parent: Option<Id>,
}

fn beat_kind() -> String {
    "beat".into()
}

/// Outline item kinds, from the outside in.
pub const OUTLINE_KINDS: [&str; 3] = ["act", "sequence", "beat"];

impl Default for Beat {
    fn default() -> Self {
        Beat { id: String::new(), logline: String::new(), summary: String::new(), scene_id: None, pos: 0.0, kind: beat_kind(), title: String::new(), parent: None }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SceneSummary {
    pub scene_id: Id,
    pub heading_block_id: Id,
    pub heading: String,
    pub block_count: usize,
}

impl Document {
    pub fn scenes(&self) -> Vec<SceneSummary> {
        let mut out: Vec<SceneSummary> = Vec::new();
        for b in &self.blocks {
            if let (BlockKind::Heading, Some(sid)) = (b.kind, &b.scene_id) {
                out.push(SceneSummary {
                    scene_id: sid.clone(),
                    heading_block_id: b.id.clone(),
                    heading: b.text(),
                    block_count: 1,
                });
            } else if let Some(last) = out.last_mut() {
                last.block_count += 1;
            }
        }
        out
    }

    /// Structural invariants the store enforces on every commit.
    pub fn validate(&self) -> Result<(), String> {
        let mut ids = std::collections::HashSet::new();
        let mut scenes = std::collections::HashSet::new();
        for b in &self.blocks {
            if !ids.insert(b.id.as_str()) {
                return Err(format!("duplicate block id {}", b.id));
            }
            match (b.kind, &b.scene_id) {
                (BlockKind::Heading, Some(s)) => {
                    if !scenes.insert(s.as_str()) {
                        return Err(format!("duplicate scene id {s}"));
                    }
                }
                (BlockKind::Heading, None) => return Err(format!("heading {} has no scene id", b.id)),
                (_, Some(_)) => return Err(format!("non-heading block {} carries a scene id", b.id)),
                _ => {}
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_document_profiles_roundtrip_and_parse_aliases() {
        for profile in DocumentProfile::ALL {
            let s = profile.as_str();
            assert_eq!(DocumentProfile::parse(s), Some(profile));
            assert!(!profile.display_name().is_empty());
        }

        assert_eq!(DocumentProfile::parse("screenplay"), Some(DocumentProfile::ScreenplayUs));
        assert_eq!(DocumentProfile::parse("us-letter"), Some(DocumentProfile::ScreenplayUs));
        assert_eq!(DocumentProfile::parse("a4"), Some(DocumentProfile::ScreenplayUk));
        assert_eq!(DocumentProfile::parse("sitcom"), Some(DocumentProfile::TeleplayMultiCam));
        assert_eq!(DocumentProfile::parse("multicam"), Some(DocumentProfile::TeleplayMultiCam));
        assert_eq!(DocumentProfile::parse("stage_play"), Some(DocumentProfile::StagePlay));
        assert_eq!(DocumentProfile::parse("theatre"), Some(DocumentProfile::StagePlay));
        assert_eq!(DocumentProfile::parse("comic_script"), Some(DocumentProfile::ComicScript));
        assert_eq!(DocumentProfile::parse("graphic-novel"), Some(DocumentProfile::ComicScript));
        assert_eq!(DocumentProfile::parse("branching"), Some(DocumentProfile::InteractiveStory));
        assert_eq!(DocumentProfile::parse("treatment_prose"), Some(DocumentProfile::TreatmentProse));
        assert_eq!(DocumentProfile::parse("unknown_xyz"), None);

        assert_eq!(DocumentProfile::ScreenplayUk.default_page_size(), "a4");
        assert_eq!(DocumentProfile::ScreenplayUs.default_page_size(), "us-letter");
        assert_eq!(DocumentProfile::TeleplayMultiCam.default_page_size(), "us-letter");
        assert_eq!(DocumentProfile::StagePlay.default_page_size(), "us-letter");
        assert_eq!(DocumentProfile::ComicScript.default_page_size(), "us-letter");
    }
}
