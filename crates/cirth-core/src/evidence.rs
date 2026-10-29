//! The evidence board (M3 step 9, ACCEPTANCE C4): a freeform canvas of
//! cards joined by labelled strings, and named bookmarks in the scripts.
//!
//! A card is a note, a picture, a video link, or a view of something that
//! lives elsewhere (a scene, a beat, a bible entry, a timeline event) by its
//! stable id; such a card never holds a copy of that thing's text. Moving a
//! card moves it on the canvas only, never the script.
//!
//! Pictures are packaged in the project file (decision E): content-addressed
//! by a hash of their bytes, checked to be PNG, JPEG, GIF or WebP, never
//! stored with an absolute path. Video links are stored as text and never
//! fetched: opening a project makes no network request (C4).

use serde::{Deserialize, Serialize};

use crate::model::Id;

pub const CARD_KINDS: [&str; 7] = ["note", "scene", "beat", "entity", "event", "image", "video"];

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
pub struct Card {
    pub id: Id,
    pub kind: String,
    /// The scene, beat, bible entry or event a card shows (by stable id).
    #[serde(default)]
    pub ref_id: Option<Id>,
    /// A note's or picture's own title, a video link's label.
    #[serde(default)]
    pub title: String,
    /// A note's text.
    #[serde(default)]
    pub body: String,
    /// A video link (http or https), never fetched.
    #[serde(default)]
    pub url: String,
    /// A packaged picture (`Asset::id`).
    #[serde(default)]
    pub asset: Option<String>,
    pub x: f64,
    pub y: f64,
}

/// A string between two cards, with what it means ("leads to", "lies about").
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
pub struct Thread {
    pub id: Id,
    pub from: Id,
    pub to: Id,
    #[serde(default)]
    pub label: String,
}

/// A named place in a script: a block, by stable id.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
pub struct Bookmark {
    pub id: Id,
    pub name: String,
    pub document_id: Id,
    pub block_id: Id,
}

/// Pictures above this size are kept but the writer is warned (the project file grows).
pub const WARN_BYTES: usize = 20 * 1024 * 1024;
/// Pictures above this size are refused.
pub const MAX_BYTES: usize = 100 * 1024 * 1024;

/// The picture type from the file's first bytes, never from its name.
pub fn image_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

/// A video link the app will hand to the browser on request: http or https,
/// no spaces or quotes, at most 2,000 characters.
pub fn valid_link(url: &str) -> bool {
    let u = url.trim();
    (u.starts_with("https://") || u.starts_with("http://")) && u.len() <= 2000 && !u.chars().any(|c| c.is_whitespace() || c.is_control() || c == '"' || c == '\'' || c == '<' || c == '>')
}

/// Standard base64 (for showing a packaged picture as a data: URL).
pub fn base64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for c in bytes.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for i in 0..4 {
            if i <= c.len() {
                out.push(T[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pictures_are_known_by_their_bytes_and_links_are_checked() {
        assert_eq!(image_type(b"\x89PNG\r\n\x1a\n...."), Some("image/png"));
        assert_eq!(image_type(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("image/jpeg"));
        assert_eq!(image_type(b"RIFF\0\0\0\0WEBPVP8 "), Some("image/webp"));
        assert_eq!(image_type(b"<svg xmlns=..."), None, "no SVG (it can carry script)");
        assert_eq!(image_type(b"MZ\x90\0"), None);
        assert!(valid_link("https://example.com/watch?v=abc"));
        assert!(!valid_link("file:///C:/secret.txt") && !valid_link("javascript:alert(1)") && !valid_link("https://a.com/\" & calc"));
    }

    #[test]
    fn base64_matches_the_standard() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }
}
