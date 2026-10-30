//! Optional AI provider integrations and prompt engine (M7, ROADMAP M7, PRODUCT_SPEC §8).
//!
//! Designed around strict principles:
//! - Disabled by default; zero unsolicited network requests; complete offline operation preserved;
//! - Bring-your-own model / endpoint (local Ollama, LM Studio, or cloud providers);
//! - Transparent scope disclosure and token estimation;
//! - Non-destructive diff review before any manuscript modification;
//! - No AI changes can directly mutate the canonical store without explicit user acceptance.

use crate::model::{new_id, Block, BlockKind, Id};
use serde::{Deserialize, Serialize};

/// Supported AI provider categories.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiProviderType {
    LocalOpenAiCompatible,
    OpenAi,
    Anthropic,
    CustomEndpoint,
}

impl Default for AiProviderType {
    fn default() -> Self {
        AiProviderType::LocalOpenAiCompatible
    }
}

/// User configuration for the AI integration.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AiConfig {
    pub enabled: bool,
    pub provider_type: AiProviderType,
    pub endpoint_url: String,
    pub model_name: String,
    pub api_key: Option<String>,
    pub temperature: f32,
    pub max_tokens: usize,
    pub timeout_seconds: u64,
}

impl Default for AiConfig {
    fn default() -> Self {
        AiConfig {
            enabled: false,
            provider_type: AiProviderType::LocalOpenAiCompatible,
            endpoint_url: "http://localhost:11434/v1".to_string(),
            model_name: "llama3.2".to_string(),
            api_key: None,
            temperature: 0.7,
            max_tokens: 1024,
            timeout_seconds: 30,
        }
    }
}

/// The authorized manuscript scope passed to the AI prompt.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiScopeKind {
    Selection,
    Block,
    Scene,
    DocumentSummary,
    ProjectBible,
}

/// High-level writing or analysis task for the AI.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "instruction", rename_all = "snake_case")]
pub enum AiTask {
    SummarizeScene,
    GenerateLogline,
    ExtractBibleCandidates,
    Paraphrase,
    Expand,
    Shorten,
    CustomInstructions(String),
}

/// Prepared payload describing the request sent to the provider.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AiPayload {
    pub provider_type: AiProviderType,
    pub endpoint_url: String,
    pub model_name: String,
    pub system_prompt: String,
    pub user_prompt: String,
    pub estimated_tokens: usize,
    pub temperature: f32,
    pub max_tokens: usize,
    pub scope_description: String,
}

/// Classification of a diff block for user review.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DiffStatus {
    Unchanged,
    Added,
    Modified,
    Removed,
}

/// An individual diff block item for side-by-side preview.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AiDiffBlock {
    pub id: Id,
    pub block_id: Option<Id>,
    pub block_kind: BlockKind,
    pub original_text: String,
    pub suggested_text: String,
    pub status: DiffStatus,
}

/// Rough rule-of-thumb token estimator (~4 characters per token in English).
pub fn estimate_tokens(text: &str) -> usize {
    if text.is_empty() {
        return 0;
    }
    (text.chars().count() + 3) / 4
}

/// Build system prompt tailored to the requested task and screenplay format.
fn build_system_prompt(task: &AiTask) -> String {
    let base = "You are an assistant for Kolbítar, a professional, offline-first screenplay and story development application. Follow standard industry screenplay formatting conventions. Never fabricate character names or facts not in the source text.";
    match task {
        AiTask::SummarizeScene => format!(
            "{base} Provide a concise 1-2 sentence beat summary capturing the central action and dramatic turning point of the scene."
        ),
        AiTask::GenerateLogline => format!(
            "{base} Provide a compelling one-sentence logline identifying the protagonist, inciting incident, primary conflict, and stakes."
        ),
        AiTask::ExtractBibleCandidates => format!(
            "{base} Extract key characters and locations mentioned in the script with brief trait descriptions in JSON array format: [{{\"name\":\"...\",\"kind\":\"character|location\",\"traits\":\"...\"}}]."
        ),
        AiTask::Paraphrase => format!(
            "{base} Rewrite the dialogue or action lines to improve flow while preserving voice, subtext, and character intentions."
        ),
        AiTask::Expand => format!(
            "{base} Expand the action lines with vivid sensory details, pacing beats, or atmospheric descriptions without adding unnecessary fluff."
        ),
        AiTask::Shorten => format!(
            "{base} Tighten and condense the provided lines to make them punchier and more economical on the page."
        ),
        AiTask::CustomInstructions(inst) => format!(
            "{base} Follow the user's explicit instructions: {inst}"
        ),
    }
}

/// Format manuscript blocks into structured text for prompt payload.
fn format_blocks_for_prompt(blocks: &[Block]) -> String {
    let mut out = String::new();
    for b in blocks {
        let prefix = match b.kind {
            BlockKind::Heading => "\nSCENE: ",
            BlockKind::Action => "\nACTION: ",
            BlockKind::Character => "\nCHARACTER: ",
            BlockKind::Parenthetical => " PAREN: ",
            BlockKind::Dialogue => " DIALOGUE: ",
            BlockKind::Transition => "\nTRANSITION: ",
            BlockKind::Shot => "\nSHOT: ",
            BlockKind::Section => "\nSECTION: ",
            BlockKind::Lyric => "\nLYRIC: ",
        };
        out.push_str(prefix);
        out.push_str(&b.text());
    }
    out.trim().to_string()
}

/// Construct the complete transparent AI request payload with scope disclosure.
pub fn build_ai_payload(
    config: &AiConfig,
    task: &AiTask,
    scope_kind: AiScopeKind,
    blocks: &[Block],
    scene_title: Option<&str>,
    bible_context: Option<&str>,
) -> AiPayload {
    let system_prompt = build_system_prompt(task);
    let mut user_prompt = String::new();

    if let Some(t) = scene_title {
        user_prompt.push_str(&format!("Scene: {}\n\n", t));
    }

    if let Some(bc) = bible_context {
        if !bc.trim().is_empty() {
            user_prompt.push_str(&format!("Project Bible Context:\n{}\n\n", bc.trim()));
        }
    }

    user_prompt.push_str("Source Manuscript Text:\n");
    user_prompt.push_str(&format_blocks_for_prompt(blocks));

    let scope_desc = match scope_kind {
        AiScopeKind::Selection => format!("Current selection ({} blocks)", blocks.len()),
        AiScopeKind::Block => format!("Single block ({:?})", blocks.first().map(|b| b.kind).unwrap_or(BlockKind::Action)),
        AiScopeKind::Scene => format!("Scene: '{}' ({} blocks)", scene_title.unwrap_or("Current Scene"), blocks.len()),
        AiScopeKind::DocumentSummary => format!("Full document summary ({} blocks)", blocks.len()),
        AiScopeKind::ProjectBible => "Project Bible entities and profiles".to_string(),
    };

    let total_chars = system_prompt.chars().count() + user_prompt.chars().count();
    let estimated_tokens = estimate_tokens(&format!("{}{}", system_prompt, user_prompt));

    AiPayload {
        provider_type: config.provider_type,
        endpoint_url: config.endpoint_url.clone(),
        model_name: config.model_name.clone(),
        system_prompt,
        user_prompt,
        estimated_tokens,
        temperature: config.temperature,
        max_tokens: config.max_tokens,
        scope_description: format!("{} (~{} tokens, {} chars)", scope_desc, estimated_tokens, total_chars),
    }
}

/// Compute a non-destructive block diff between original manuscript blocks and an AI suggestion.
pub fn compute_block_diffs(original_blocks: &[Block], ai_suggestion_text: &str) -> Vec<AiDiffBlock> {
    let lines: Vec<&str> = ai_suggestion_text
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect();

    let mut diffs = Vec::new();

    if original_blocks.is_empty() {
        for line in lines {
            diffs.push(AiDiffBlock {
                id: new_id(),
                block_id: None,
                block_kind: BlockKind::Action,
                original_text: String::new(),
                suggested_text: line.to_string(),
                status: DiffStatus::Added,
            });
        }
        return diffs;
    }

    // Line-by-line / block-by-block matching
    let max_len = original_blocks.len().max(lines.len());
    for i in 0..max_len {
        let orig = original_blocks.get(i);
        let sugg = lines.get(i);

        match (orig, sugg) {
            (Some(o), Some(&s)) => {
                let orig_text = o.text();
                if orig_text == s {
                    diffs.push(AiDiffBlock {
                        id: new_id(),
                        block_id: Some(o.id.clone()),
                        block_kind: o.kind,
                        original_text: orig_text,
                        suggested_text: s.to_string(),
                        status: DiffStatus::Unchanged,
                    });
                } else {
                    diffs.push(AiDiffBlock {
                        id: new_id(),
                        block_id: Some(o.id.clone()),
                        block_kind: o.kind,
                        original_text: orig_text,
                        suggested_text: s.to_string(),
                        status: DiffStatus::Modified,
                    });
                }
            }
            (Some(o), None) => {
                diffs.push(AiDiffBlock {
                    id: new_id(),
                    block_id: Some(o.id.clone()),
                    block_kind: o.kind,
                    original_text: o.text(),
                    suggested_text: String::new(),
                    status: DiffStatus::Removed,
                });
            }
            (None, Some(&s)) => {
                diffs.push(AiDiffBlock {
                    id: new_id(),
                    block_id: None,
                    block_kind: BlockKind::Action,
                    original_text: String::new(),
                    suggested_text: s.to_string(),
                    status: DiffStatus::Added,
                });
            }
            (None, None) => {}
        }
    }

    diffs
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_token_estimator() {
        assert_eq!(estimate_tokens(""), 0);
        assert_eq!(estimate_tokens("Hello world"), 3);
        assert_eq!(estimate_tokens("12345678"), 2);
    }

    #[test]
    fn test_build_ai_payload_scope_disclosure() {
        let config = AiConfig {
            enabled: true,
            provider_type: AiProviderType::LocalOpenAiCompatible,
            endpoint_url: "http://127.0.0.1:11434/v1".to_string(),
            model_name: "llama3.2".to_string(),
            ..Default::default()
        };

        let blocks = vec![
            Block::new(BlockKind::Heading, "INT. CONTROL ROOM - NIGHT"),
            Block::new(BlockKind::Action, "Vance stares at the silent telemetry monitor."),
        ];

        let payload = build_ai_payload(
            &config,
            &AiTask::SummarizeScene,
            AiScopeKind::Scene,
            &blocks,
            Some("INT. CONTROL ROOM - NIGHT"),
            None,
        );

        assert!(payload.system_prompt.contains("Kolbítar"));
        assert!(payload.user_prompt.contains("Vance stares at the silent telemetry monitor."));
        assert!(payload.scope_description.contains("Scene: 'INT. CONTROL ROOM - NIGHT' (2 blocks)"));
        assert!(payload.estimated_tokens > 20);
    }

    #[test]
    fn test_compute_block_diffs_modified() {
        let orig = vec![
            Block::new(BlockKind::Action, "She stepped into the dark room."),
            Block::new(BlockKind::Dialogue, "Hello?"),
        ];

        let ai_suggestion = "She cautiously entered the shadowy chamber.\nHello?";
        let diffs = compute_block_diffs(&orig, ai_suggestion);

        assert_eq!(diffs.len(), 2);
        assert_eq!(diffs[0].status, DiffStatus::Modified);
        assert_eq!(diffs[0].original_text, "She stepped into the dark room.");
        assert_eq!(diffs[0].suggested_text, "She cautiously entered the shadowy chamber.");

        assert_eq!(diffs[1].status, DiffStatus::Unchanged);
        assert_eq!(diffs[1].original_text, "Hello?");
        assert_eq!(diffs[1].suggested_text, "Hello?");
    }

    #[test]
    fn test_compute_block_diffs_added_and_removed() {
        let orig = vec![
            Block::new(BlockKind::Action, "Line 1"),
            Block::new(BlockKind::Action, "Line 2"),
        ];

        let ai_suggestion = "Line 1\nLine 2\nLine 3";
        let diffs = compute_block_diffs(&orig, ai_suggestion);

        assert_eq!(diffs.len(), 3);
        assert_eq!(diffs[0].status, DiffStatus::Unchanged);
        assert_eq!(diffs[1].status, DiffStatus::Unchanged);
        assert_eq!(diffs[2].status, DiffStatus::Added);
        assert_eq!(diffs[2].suggested_text, "Line 3");
    }
}
