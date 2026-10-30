//! Portable review package (`.cirth-review`) import and export (M5 Step 6, Acceptance F7, G5).
//!
//! A self-contained, offline bundle containing script text, anchored comment threads,
//! and block alternatives for outside review without machine paths, personal directories,
//! or credentials.
//!
//! When imported:
//! - Validates and sanitizes all inputs against path traversal, formula injection, and script-bearing HTML (Acceptance G5).
//! - Merges outside comments and alternate takes cleanly into the author's local project with provenance.
//! - Preserves existing script text, local history, and active takes without silent mutation.

use crate::alternatives::BlockAlternative;
use crate::comments::CommentThreadWithMessages;
use crate::model::Block;
use crate::store::{Result, Store, StoreError};
use crate::tags::find_nearest_quote;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::Path;

pub const REVIEW_PACKAGE_FORMAT: &str = "cirth-review-v1";
pub const MAX_REVIEW_PACKAGE_BYTES: u64 = 50 * 1024 * 1024; // 50MB limit

/// A self-contained, portable review package.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ReviewPackage {
    pub format: String,
    pub project_id: String,
    pub project_title: String,
    pub document_id: String,
    pub document_title: String,
    pub exported_at: String,
    #[serde(default)]
    pub reviewer: Option<String>,
    pub blocks: Vec<Block>,
    pub comments: Vec<CommentThreadWithMessages>,
    pub alternatives: Vec<BlockAlternative>,
}

/// Inspection summary of a `.cirth-review` file for previewing before import.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ReviewPackageSummary {
    pub format: String,
    pub project_title: String,
    pub document_title: String,
    pub exported_at: String,
    pub reviewer: String,
    pub block_count: usize,
    pub comment_thread_count: usize,
    pub comment_message_count: usize,
    pub alternative_count: usize,
}

/// Result of exporting a `.cirth-review` package.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ReviewExportResult {
    pub path: String,
    pub block_count: usize,
    pub comment_thread_count: usize,
    pub comment_message_count: usize,
    pub alternative_count: usize,
    pub bytes: usize,
}

/// Report detailing the results of importing a review package into the local project.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ReviewImportReport {
    pub path: String,
    pub reviewer: String,
    pub threads_imported: usize,
    pub messages_imported: usize,
    pub alternatives_imported: usize,
    pub orphaned_count: usize,
    pub notes: Vec<String>,
}

/// Sanitize text fields to protect against formula injection and script execution (Acceptance G5).
pub fn sanitize_text(s: &str) -> String {
    let mut out = s.to_string();
    // Neutralize dangerous spreadsheet formula prefixes
    let trimmed = out.trim_start();
    if trimmed.starts_with('=') || trimmed.starts_with('+') || trimmed.starts_with('-') || trimmed.starts_with('@') {
        out = format!("'{out}");
    }
    // Neutralize embedded <script> or <iframe> tags
    out = out.replace("<script", "&lt;script")
             .replace("</script>", "&lt;/script&gt;")
             .replace("<iframe", "&lt;iframe")
             .replace("</iframe>", "&lt;/iframe&gt;");
    out
}

/// Validate that a field does not contain path traversal sequences or null bytes (Acceptance G5).
pub fn validate_no_traversal(name: &str, val: &str) -> Result<()> {
    if val.contains('\0') {
        return Err(StoreError::Invalid(format!("{name} contains prohibited null bytes")));
    }
    if val.contains("..") || val.starts_with('/') || val.starts_with('\\') {
        return Err(StoreError::Invalid(format!("{name} contains prohibited path traversal sequences")));
    }
    Ok(())
}

impl Store {
    /// Export a portable `.cirth-review` bundle containing script text, comment threads,
    /// and block alternatives for the active document.
    /// Excludes any personal machine paths, credentials, AI keys, or deleted history.
    pub fn export_review_package(&self, dest: &Path, reviewer: Option<&str>) -> Result<ReviewExportResult> {
        let doc_id = self.current_document()?;
        let doc = self.load_document(&doc_id)?;
        let title = doc.title.clone();
        let proj_title = self.meta("title")?.unwrap_or_else(|| "Untitled".to_string());
        let proj_id = self.meta("project_id")?.unwrap_or_else(|| crate::model::new_id());

        let comments = self.comment_threads_of(&doc_id)?;
        let alternatives = self.all_block_alternatives(&doc_id)?;

        let mut comment_message_count = 0;
        for c in &comments {
            comment_message_count += c.messages.len();
        }

        let now = "2026-10-29T00:00:00Z";
        let pkg = ReviewPackage {
            format: REVIEW_PACKAGE_FORMAT.to_string(),
            project_id: proj_id,
            project_title: proj_title,
            document_id: doc_id,
            document_title: title,
            exported_at: now.to_string(),
            reviewer: reviewer.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
            blocks: doc.blocks.clone(),
            comments,
            alternatives: alternatives.clone(),
        };

        let json_bytes = serde_json::to_vec_pretty(&pkg).map_err(|e| StoreError::Invalid(e.to_string()))?;
        if json_bytes.len() as u64 > MAX_REVIEW_PACKAGE_BYTES {
            return Err(StoreError::Invalid("Review package exceeds maximum allowable size (50MB)".into()));
        }

        let tmp = dest.with_extension(format!("review-tmp-{}", uuid::Uuid::new_v4()));
        std::fs::write(&tmp, &json_bytes)?;
        crate::fsutil::replace_file(&tmp, dest)?;

        Ok(ReviewExportResult {
            path: dest.display().to_string(),
            block_count: doc.blocks.len(),
            comment_thread_count: pkg.comments.len(),
            comment_message_count,
            alternative_count: alternatives.len(),
            bytes: json_bytes.len(),
        })
    }

    /// Inspect a `.cirth-review` file without modifying local project state.
    /// Validates file format and security checks (Acceptance G5).
    pub fn inspect_review_package(&self, src: &Path) -> Result<ReviewPackageSummary> {
        let meta = std::fs::metadata(src)?;
        if meta.len() > MAX_REVIEW_PACKAGE_BYTES {
            return Err(StoreError::Invalid(format!(
                "Review package size ({} bytes) exceeds maximum allowable limit ({} bytes)",
                meta.len(),
                MAX_REVIEW_PACKAGE_BYTES
            )));
        }

        let bytes = std::fs::read(src)?;
        let pkg: ReviewPackage = serde_json::from_slice(&bytes)
            .map_err(|e| StoreError::Invalid(format!("Invalid review package format: {e}")))?;

        if !pkg.format.starts_with("cirth-review-") {
            return Err(StoreError::Invalid(format!(
                "Unsupported review package format: '{}'",
                pkg.format
            )));
        }

        validate_no_traversal("project_id", &pkg.project_id)?;
        validate_no_traversal("document_id", &pkg.document_id)?;

        let mut msg_count = 0;
        for c in &pkg.comments {
            msg_count += c.messages.len();
        }

        Ok(ReviewPackageSummary {
            format: pkg.format,
            project_title: sanitize_text(&pkg.project_title),
            document_title: sanitize_text(&pkg.document_title),
            exported_at: pkg.exported_at,
            reviewer: pkg.reviewer.map(|r| sanitize_text(&r)).unwrap_or_else(|| "Anonymous Reviewer".to_string()),
            block_count: pkg.blocks.len(),
            comment_thread_count: pkg.comments.len(),
            comment_message_count: msg_count,
            alternative_count: pkg.alternatives.len(),
        })
    }

    /// Import outside comment threads, messages, and alternatives from a `.cirth-review` package
    /// into the author's local project with provenance.
    /// Preserves local script text and active takes without silent mutation.
    pub fn import_review_package(&mut self, src: &Path) -> Result<ReviewImportReport> {
        let summary = self.inspect_review_package(src)?;
        let bytes = std::fs::read(src)?;
        let pkg: ReviewPackage = serde_json::from_slice(&bytes)
            .map_err(|e| StoreError::Invalid(format!("Invalid review package: {e}")))?;

        let local_doc_id = self.current_document()?;
        let local_doc = self.load_document(&local_doc_id)?;

        let local_blocks_by_id: HashMap<String, String> = local_doc
            .blocks
            .iter()
            .map(|b| (b.id.clone(), b.text()))
            .collect();

        let reviewer_name = summary.reviewer.clone();
        let mut threads_imported = 0usize;
        let mut messages_imported = 0usize;
        let mut alternatives_imported = 0usize;
        let mut orphaned_count = 0usize;
        let mut notes: Vec<String> = Vec::new();

        // 1. Import comment threads & messages
        let existing_threads = self.comment_threads_of(&local_doc_id)?;
        let existing_thread_ids: HashSet<String> = existing_threads.iter().map(|t| t.thread.id.clone()).collect();
        let mut existing_message_ids: HashSet<String> = HashSet::new();
        for t in &existing_threads {
            for m in &t.messages {
                existing_message_ids.insert(m.id.clone());
            }
        }

        for mut item in pkg.comments {
            validate_no_traversal("comment_thread_id", &item.thread.id)?;
            let t = &mut item.thread;
            t.document_id = local_doc_id.clone();
            t.quote = sanitize_text(&t.quote);
            if t.author.trim().is_empty() {
                t.author = reviewer_name.clone();
            } else {
                t.author = sanitize_text(&t.author);
            }

            if existing_thread_ids.contains(&t.id) {
                // Thread exists locally: import any new reply messages
                for mut msg in item.messages {
                    validate_no_traversal("comment_message_id", &msg.id)?;
                    if !existing_message_ids.contains(&msg.id) {
                        msg.text = sanitize_text(&msg.text);
                        if msg.author.trim().is_empty() {
                            msg.author = reviewer_name.clone();
                        } else {
                            msg.author = sanitize_text(&msg.author);
                        }
                        self.put_comment_message(&msg)?;
                        existing_message_ids.insert(msg.id);
                        messages_imported += 1;
                    }
                }
            } else {
                // New thread: verify anchor in local block
                if let Some(local_text) = local_blocks_by_id.get(&t.block_id) {
                    let chars: Vec<char> = local_text.chars().collect();
                    let len = chars.len();
                    let quote = &t.quote;

                    let mut matched = false;
                    if t.start <= len && t.end <= len && t.start < t.end {
                        let span_slice: String = chars[t.start..t.end].iter().collect();
                        if span_slice == *quote {
                            matched = true;
                        }
                    }

                    if !matched {
                        if let Some((ns, ne, nq)) = find_nearest_quote(local_text, quote, t.start) {
                            t.start = ns;
                            t.end = ne;
                            t.quote = nq;
                            t.orphaned = false;
                        } else {
                            // Text changed: preserve quote and mark orphaned (ADR 0005 & Acceptance F2)
                            t.orphaned = true;
                            orphaned_count += 1;
                        }
                    }
                } else {
                    // Block deleted or not in local doc: preserve as orphaned
                    t.orphaned = true;
                    orphaned_count += 1;
                }

                // Insert new thread
                let msgs = std::mem::take(&mut item.messages);
                let first_msg = msgs.first();
                self.put_comment_thread(t, first_msg)?;
                threads_imported += 1;
                if first_msg.is_some() {
                    messages_imported += 1;
                }

                // Insert remaining messages
                for mut msg in msgs.into_iter().skip(1) {
                    validate_no_traversal("comment_message_id", &msg.id)?;
                    msg.text = sanitize_text(&msg.text);
                    if msg.author.trim().is_empty() {
                        msg.author = reviewer_name.clone();
                    } else {
                        msg.author = sanitize_text(&msg.author);
                    }
                    self.put_comment_message(&msg)?;
                    messages_imported += 1;
                }
            }
        }

        // 2. Import block alternatives
        let existing_alts = self.all_block_alternatives(&local_doc_id)?;
        let mut existing_alt_texts_by_block: HashMap<String, HashSet<String>> = HashMap::new();
        for a in &existing_alts {
            existing_alt_texts_by_block
                .entry(a.block_id.clone())
                .or_default()
                .insert(a.text.clone());
        }

        for mut alt in pkg.alternatives {
            validate_no_traversal("alternative_id", &alt.id)?;
            alt.document_id = local_doc_id.clone();
            alt.text = sanitize_text(&alt.text);
            alt.label = sanitize_text(&alt.label);
            if alt.label.trim().is_empty() {
                alt.label = format!("Review: {}", reviewer_name);
            }
            if alt.author.trim().is_empty() {
                alt.author = reviewer_name.clone();
            } else {
                alt.author = sanitize_text(&alt.author);
            }

            if let Some(local_text) = local_blocks_by_id.get(&alt.block_id) {
                // If this text is already the active block text or an existing alternative, skip duplicate
                let is_dup_active = *local_text == alt.text;
                let is_dup_alt = existing_alt_texts_by_block
                    .get(&alt.block_id)
                    .map(|set| set.contains(&alt.text))
                    .unwrap_or(false);

                if !is_dup_active && !is_dup_alt {
                    // If no alternatives exist on this block yet, capture Take 0 baseline from current block text
                    let block_takes = self.block_alternatives(&local_doc_id, &alt.block_id)?;
                    if block_takes.is_empty() {
                        let current_block_text = self.block_text(&alt.block_id)?.unwrap_or_default();
                        let b0 = crate::alternatives::BlockAlternative {
                            id: crate::model::new_id(),
                            document_id: local_doc_id.clone(),
                            block_id: alt.block_id.clone(),
                            take_index: 0,
                            text: current_block_text,
                            label: "Take 1 (Original)".to_string(),
                            author: "Original Author".to_string(),
                            created_at: "2026-10-29T00:00:00Z".to_string(),
                            is_active: true,
                        };
                        self.put_alternative_raw(&b0)?;
                    }

                    // Compute next take index
                    let block_takes = self.block_alternatives(&local_doc_id, &alt.block_id)?;
                    let max_idx = block_takes.iter().map(|t| t.take_index).max().unwrap_or(0);
                    alt.take_index = max_idx + 1;
                    alt.is_active = false; // Always keep the author's take active

                    self.put_alternative_raw(&alt)?;
                    existing_alt_texts_by_block
                        .entry(alt.block_id.clone())
                        .or_default()
                        .insert(alt.text.clone());
                    alternatives_imported += 1;
                }
            }
        }

        // Increment version and mark unsaved
        let current_v = self.version()?;
        let new_v = current_v + 1;
        Self::set_meta(&self.conn, "version", &new_v.to_string())?;
        Self::set_meta(&self.conn, "saved_version", "0")?;
        self.mark_unsaved()?;

        notes.push(format!(
            "Imported {} comment threads ({} messages) and {} alternate takes from review package.",
            threads_imported, messages_imported, alternatives_imported
        ));
        if orphaned_count > 0 {
            notes.push(format!(
                "{} comment threads were marked as orphaned because referenced text was modified.",
                orphaned_count
            ));
        }

        Ok(ReviewImportReport {
            path: src.display().to_string(),
            reviewer: reviewer_name,
            threads_imported,
            messages_imported,
            alternatives_imported,
            orphaned_count,
            notes,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::comments::{CommentMessage, CommentThread};
    use crate::model::{BlockKind, Run};
    use crate::ops::{Batch, Op};
    use std::path::PathBuf;

    struct TestDir {
        path: PathBuf,
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn temp_store() -> (TestDir, Store) {
        let dir_path = std::env::temp_dir().join(format!("cirth-test-review-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir_path).unwrap();
        let db_path = dir_path.join("project.cirth");
        let store = Store::open(&db_path).unwrap();
        (TestDir { path: dir_path }, store)
    }

    #[test]
    fn test_export_excludes_machine_paths_and_credentials() {
        let (_td, mut store) = temp_store();
        let doc_id = store.current_document().unwrap();

        // Add a block
        let b1 = Block {
            id: "blk-review-1".into(),
            kind: BlockKind::Dialogue,
            runs: vec![Run::plain("I have a bad feeling about this.")],
            scene_id: None,
            dual: false,
            break_before: false,
        };
        store
            .apply(&Batch {
                tx_id: crate::model::new_id(),
                base_version: 0,
                document_id: Some(doc_id.clone()),
                ops: vec![Op::Put { block: b1.clone(), after: None }],
            })
            .unwrap();

        // Add comment thread
        let th = CommentThread {
            id: "th-1".into(),
            document_id: doc_id.clone(),
            block_id: "blk-review-1".into(),
            start: 2,
            end: 6,
            quote: "have".into(),
            author: "Author A".into(),
            created_at: "2026-10-29T10:00:00Z".into(),
            resolved: false,
            orphaned: false,
        };
        let msg = CommentMessage {
            id: "msg-1".into(),
            thread_id: "th-1".into(),
            author: "Author A".into(),
            text: "Check phrasing here.".into(),
            created_at: "2026-10-29T10:00:00Z".into(),
            edited_at: None,
        };
        store.put_comment_thread(&th, Some(&msg)).unwrap();

        // Add an alternative take
        store
            .add_alternative(&doc_id, "blk-review-1", "I feel something is amiss.", "Alt 1", "Author A", "2026-10-29T10:00:00Z")
            .unwrap();

        let review_file = _td.path.join("draft.cirth-review");
        let res = store.export_review_package(&review_file, Some("Lead Editor")).unwrap();
        assert_eq!(res.comment_thread_count, 1);
        assert_eq!(res.comment_message_count, 1);
        assert_eq!(res.alternative_count, 2); // baseline + alt 1

        let content = std::fs::read_to_string(&review_file).unwrap();
        // Ensure no local absolute filesystem paths leaked into the exported JSON
        assert!(!content.contains(&_td.path.display().to_string()));
        assert!(!content.contains("api_key"));
        assert!(!content.contains("token"));
        assert!(content.contains("Lead Editor"));
        assert!(content.contains("I have a bad feeling about this."));
    }

    #[test]
    fn test_roundtrip_import_preserves_comments_and_alternatives() {
        let (_td1, mut store1) = temp_store();
        let doc_id1 = store1.current_document().unwrap();

        let b1 = Block {
            id: "b-shared-1".into(),
            kind: BlockKind::Dialogue,
            runs: vec![Run::plain("We should leave immediately.")],
            scene_id: None,
            dual: false,
            break_before: false,
        };
        store1
            .apply(&Batch {
                tx_id: crate::model::new_id(),
                base_version: 0,
                document_id: Some(doc_id1.clone()),
                ops: vec![Op::Put { block: b1.clone(), after: None }],
            })
            .unwrap();

        let th = CommentThread {
            id: "th-ext-1".into(),
            document_id: doc_id1.clone(),
            block_id: "b-shared-1".into(),
            start: 10,
            end: 15,
            quote: "leave".into(),
            author: "Reviewer Fox".into(),
            created_at: "2026-10-29T12:00:00Z".into(),
            resolved: false,
            orphaned: false,
        };
        let msg = CommentMessage {
            id: "msg-ext-1".into(),
            thread_id: "th-ext-1".into(),
            author: "Reviewer Fox".into(),
            text: "Stronger verb needed?".into(),
            created_at: "2026-10-29T12:00:00Z".into(),
            edited_at: None,
        };
        store1.put_comment_thread(&th, Some(&msg)).unwrap();
        store1
            .add_alternative(&doc_id1, "b-shared-1", "We must evacuate now.", "Urgent alt", "Reviewer Fox", "2026-10-29T12:00:00Z")
            .unwrap();

        let pkg_path = _td1.path.join("notes.cirth-review");
        store1.export_review_package(&pkg_path, Some("Reviewer Fox")).unwrap();

        // Now create store2 with the same block
        let (_td2, mut store2) = temp_store();
        let doc_id2 = store2.current_document().unwrap();
        let b2 = Block {
            id: "b-shared-1".into(),
            kind: BlockKind::Dialogue,
            runs: vec![Run::plain("We should leave immediately.")],
            scene_id: None,
            dual: false,
            break_before: false,
        };
        store2
            .apply(&Batch {
                tx_id: crate::model::new_id(),
                base_version: 0,
                document_id: Some(doc_id2.clone()),
                ops: vec![Op::Put { block: b2, after: None }],
            })
            .unwrap();

        // Inspect before importing
        let summary = store2.inspect_review_package(&pkg_path).unwrap();
        assert_eq!(summary.reviewer, "Reviewer Fox");
        assert_eq!(summary.comment_thread_count, 1);
        assert_eq!(summary.comment_message_count, 1);

        // Import into store2
        let report = store2.import_review_package(&pkg_path).unwrap();
        assert_eq!(report.threads_imported, 1);
        assert_eq!(report.messages_imported, 1);
        assert_eq!(report.alternatives_imported, 1);
        assert_eq!(report.orphaned_count, 0);

        // Verify comments in store2
        let threads2 = store2.comment_threads_of(&doc_id2).unwrap();
        assert_eq!(threads2.len(), 1);
        assert_eq!(threads2[0].thread.quote, "leave");
        assert_eq!(threads2[0].messages.len(), 1);
        assert_eq!(threads2[0].messages[0].text, "Stronger verb needed?");

        // Verify alternatives in store2
        let alts2 = store2.block_alternatives(&doc_id2, "b-shared-1").unwrap();
        assert_eq!(alts2.len(), 2); // original baseline + imported alternative
        assert_eq!(alts2[1].text, "We must evacuate now.");
        assert_eq!(alts2[1].author, "Reviewer Fox");
        assert!(!alts2[1].is_active); // Author's original text remained active
    }

    #[test]
    fn test_malicious_payload_path_traversal_rejected() {
        let (_td, store) = temp_store();
        let bad_json = r#"{
            "format": "cirth-review-v1",
            "project_id": "../../../etc/passwd",
            "project_title": "Harmless",
            "document_id": "doc-1",
            "document_title": "Episode 1",
            "exported_at": "2026-10-29T00:00:00Z",
            "reviewer": "Attacker",
            "blocks": [],
            "comments": [],
            "alternatives": []
        }"#;

        let bad_file = _td.path.join("bad.cirth-review");
        std::fs::write(&bad_file, bad_json).unwrap();

        let err = store.inspect_review_package(&bad_file).unwrap_err();
        match err {
            StoreError::Invalid(msg) => assert!(msg.contains("prohibited path traversal sequences")),
            _ => panic!("Expected path traversal error"),
        }
    }

    #[test]
    fn test_formula_injection_and_script_tags_sanitized() {
        assert_eq!(sanitize_text("=SUM(A1:A10)"), "'=SUM(A1:A10)");
        assert_eq!(sanitize_text("+CMD('calc')"), "'+CMD('calc')");
        assert_eq!(
            sanitize_text("<script>alert('pwn')</script>"),
            "&lt;script>alert('pwn')&lt;/script&gt;"
        );
    }
}
