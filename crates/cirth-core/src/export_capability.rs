//! Export capability analysis and Google Docs / Sheets workflow adapter (M7, docs/INTEROPERABILITY.md).
//!
//! Evaluates the structural fidelity, supported features, and potential semantic losses
//! when transferring Kolbítar documents into cloud ecosystems (Google Docs, Google Sheets,
//! Final Draft, PDF, or plain text).

use crate::model::DocumentProfile;
use serde::{Deserialize, Serialize};

/// Target external export formats.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TargetFormat {
    DocxGoogleDocs,
    XlsxGoogleSheets,
    CsvGoogleSheets,
    Fdx,
    Pdf,
    PlainText,
    Html,
    Twee,
    Json,
}

/// Graded fidelity level for the export combination.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FidelityGrade {
    Authoritative,
    HighFidelity,
    LossyStructural,
    Incompatible,
}

/// Comprehensive capability report detailing fidelity, warnings, and workflow instructions.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExportCapabilityReport {
    pub target_format: TargetFormat,
    pub source_profile: DocumentProfile,
    pub fidelity_grade: FidelityGrade,
    pub is_supported: bool,
    pub supported_features: Vec<String>,
    pub loss_warnings: Vec<String>,
    pub cloud_workflow_guidance: String,
}

/// Analyze export capability and produce fidelity report and loss warnings.
pub fn analyze_export_capability(
    profile: DocumentProfile,
    target: TargetFormat,
    has_dual_dialogue: bool,
    has_locked_pages: bool,
) -> ExportCapabilityReport {
    let mut supported_features = Vec::new();
    let mut loss_warnings = Vec::new();

    match target {
        TargetFormat::DocxGoogleDocs => {
            match profile {
                DocumentProfile::TreatmentProse => {
                    supported_features.push("Heading hierarchy (H1-H3) mapped to native Word styles".to_string());
                    supported_features.push("Body paragraphs, blockquotes, and bullet lists".to_string());
                    supported_features.push("Character spotlights and reading time metadata".to_string());
                    ExportCapabilityReport {
                        target_format: target,
                        source_profile: profile,
                        fidelity_grade: FidelityGrade::HighFidelity,
                        is_supported: true,
                        supported_features,
                        loss_warnings,
                        cloud_workflow_guidance: "Upload .docx to Google Drive and open with Google Docs. Treatments map 1:1 to word processor styles and are ideal for collaborative room development.".to_string(),
                    }
                }
                DocumentProfile::InteractiveStory => {
                    supported_features.push("Linear text content of all passages".to_string());
                    loss_warnings.push("Interactive branching choices ([[Choice -> Target]]) and conditional logic are flattened into linear reading text.".to_string());
                    loss_warnings.push("For playable branching experiences, export as Playable HTML or Twee 3 instead.".to_string());
                    ExportCapabilityReport {
                        target_format: target,
                        source_profile: profile,
                        fidelity_grade: FidelityGrade::LossyStructural,
                        is_supported: true,
                        supported_features,
                        loss_warnings,
                        cloud_workflow_guidance: "Google Docs cannot execute interactive graph logic; this export produces a linear reading transcript for editorial review.".to_string(),
                    }
                }
                DocumentProfile::ComicScript => {
                    supported_features.push("Page and panel descriptions, character balloons, and SFX".to_string());
                    loss_warnings.push("Comic panel layout geometry and balloon anchors are flattened into standard screenplay indent styles.".to_string());
                    ExportCapabilityReport {
                        target_format: target,
                        source_profile: profile,
                        fidelity_grade: FidelityGrade::LossyStructural,
                        is_supported: true,
                        supported_features,
                        loss_warnings,
                        cloud_workflow_guidance: "Upload .docx to Google Docs for script reading and lettering review. Use Kolbítar's native comic tools for panel counting and continuity reconciliation.".to_string(),
                    }
                }
                _ => {
                    supported_features.push("Semantic screenplay paragraph styles (Heading, Action, Cue, Parenthetical, Dialogue, Transition)".to_string());
                    supported_features.push("Explicit paper size and margins".to_string());
                    supported_features.push("Courier Prime 12pt typographic style".to_string());
                    supported_features.push("Title page section with metadata".to_string());

                    loss_warnings.push("Google Docs reflows lines on view; line wraps and 55 lines/page pagination may differ from Kolbítar's exact layout. Use PDF for authoritative production pagination.".to_string());
                    if has_dual_dialogue {
                        loss_warnings.push("Dual dialogue is serialized sequentially (one speech following the other) in Word/Google Docs.".to_string());
                    }
                    if has_locked_pages {
                        loss_warnings.push("Locked production A/B page breaks are dynamic in Google Docs and will not retain locked page numbering.".to_string());
                    }
                    loss_warnings.push("Private project notes, inactive takes, and comment threads are omitted from standard export.".to_string());

                    ExportCapabilityReport {
                        target_format: target,
                        source_profile: profile,
                        fidelity_grade: FidelityGrade::HighFidelity,
                        is_supported: true,
                        supported_features,
                        loss_warnings,
                        cloud_workflow_guidance: "Upload .docx to Google Drive and open with Google Docs. To collaborate with outside readers without losing formatting, ask readers to use 'Suggesting' mode. Return revision feedback to Kolbítar using Review Packages (.cirth-review).".to_string(),
                    }
                }
            }
        }
        TargetFormat::XlsxGoogleSheets | TargetFormat::CsvGoogleSheets => {
            loss_warnings.push("Script prose is dramatic narrative, not tabular data. Screenplay text cannot be converted directly into spreadsheet cells.".to_string());
            loss_warnings.push("To collaborate in Google Sheets, export script-derived tabular reports: Scene Breakdown, Cast Participation, Locations, or Stripboard Schedule.".to_string());
            ExportCapabilityReport {
                target_format: target,
                source_profile: profile,
                fidelity_grade: FidelityGrade::Incompatible,
                is_supported: false,
                supported_features,
                loss_warnings,
                cloud_workflow_guidance: "Use File > Export > Reports (StoryScry) or Stripboard to generate Google Sheets-compatible XLSX/CSV files with stable scene numbers, durations, and cast tags.".to_string(),
            }
        }
        TargetFormat::Pdf => {
            supported_features.push("100% authoritative production pagination".to_string());
            supported_features.push("Bundled Courier Prime 12pt layout".to_string());
            supported_features.push("Locked scene numbers in both margins".to_string());
            supported_features.push("A-page production pagination and colored revision stars".to_string());
            supported_features.push("Title page and dual dialogue columns".to_string());

            ExportCapabilityReport {
                target_format: target,
                source_profile: profile,
                fidelity_grade: FidelityGrade::Authoritative,
                is_supported: true,
                supported_features,
                loss_warnings,
                cloud_workflow_guidance: "Upload PDF to Google Drive for read-only distribution, watermarked reading copies, or actor sides. Non-editable.".to_string(),
            }
        }
        TargetFormat::Fdx => {
            match profile {
                DocumentProfile::InteractiveStory | DocumentProfile::TreatmentProse => {
                    loss_warnings.push("Final Draft (.fdx) is designed for screenplays and cannot represent interactive branching graphs or prose treatments natively.".to_string());
                    ExportCapabilityReport {
                        target_format: target,
                        source_profile: profile,
                        fidelity_grade: FidelityGrade::LossyStructural,
                        is_supported: true,
                        supported_features: vec!["Screenplay element flattening".to_string()],
                        loss_warnings,
                        cloud_workflow_guidance: "Flattens content into generic screenplay action lines.".to_string(),
                    }
                }
                _ => {
                    supported_features.push("Industry standard Final Draft XML elements".to_string());
                    supported_features.push("Dual dialogue and scene numbers".to_string());
                    supported_features.push("Title page and character cues".to_string());

                    ExportCapabilityReport {
                        target_format: target,
                        source_profile: profile,
                        fidelity_grade: FidelityGrade::HighFidelity,
                        is_supported: true,
                        supported_features,
                        loss_warnings,
                        cloud_workflow_guidance: "Standard FDX exchange file for production departments using Final Draft.".to_string(),
                    }
                }
            }
        }
        TargetFormat::PlainText => {
            supported_features.push("Clean ASCII/UTF-8 reading text".to_string());
            supported_features.push("Page breaks matching PDF via form feeds (\\f)".to_string());
            loss_warnings.push("Plain text does not preserve font formatting, bold, italic, or color.".to_string());

            ExportCapabilityReport {
                target_format: target,
                source_profile: profile,
                fidelity_grade: FidelityGrade::HighFidelity,
                is_supported: true,
                supported_features,
                loss_warnings,
                cloud_workflow_guidance: "Lightweight, universal plain-text interchange.".to_string(),
            }
        }
        TargetFormat::Html => {
            supported_features.push("Semantic HTML5 markup with Courier Prime font".to_string());
            supported_features.push("Self-contained readable browser page".to_string());

            ExportCapabilityReport {
                target_format: target,
                source_profile: profile,
                fidelity_grade: FidelityGrade::HighFidelity,
                is_supported: true,
                supported_features,
                loss_warnings,
                cloud_workflow_guidance: "Shareable self-contained web page for reading in any web browser without extra software.".to_string(),
            }
        }
        TargetFormat::Twee => {
            let is_interactive = profile == DocumentProfile::InteractiveStory;
            ExportCapabilityReport {
                target_format: target,
                source_profile: profile,
                fidelity_grade: if is_interactive { FidelityGrade::HighFidelity } else { FidelityGrade::Incompatible },
                is_supported: is_interactive,
                supported_features: if is_interactive { vec!["Twee 3 story format passages and links".to_string()] } else { Vec::new() },
                loss_warnings: if !is_interactive { vec!["Twee 3 format is only applicable to Interactive Story documents.".to_string()] } else { Vec::new() },
                cloud_workflow_guidance: "Compatible with Twine 2 and Twee compilers for interactive story development.".to_string(),
            }
        }
        TargetFormat::Json => {
            supported_features.push("Machine-readable structured schema".to_string());
            ExportCapabilityReport {
                target_format: target,
                source_profile: profile,
                fidelity_grade: FidelityGrade::HighFidelity,
                is_supported: true,
                supported_features,
                loss_warnings,
                cloud_workflow_guidance: "JSON export for pipeline tools and custom analysis scripts.".to_string(),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_screenplay_to_google_docs_capability() {
        let report = analyze_export_capability(
            DocumentProfile::ScreenplayUs,
            TargetFormat::DocxGoogleDocs,
            true,
            true,
        );

        assert!(report.is_supported);
        assert_eq!(report.fidelity_grade, FidelityGrade::HighFidelity);
        assert!(report.supported_features.iter().any(|f| f.contains("Semantic screenplay paragraph styles")));
        assert!(report.loss_warnings.iter().any(|w| w.contains("Dual dialogue is serialized sequentially")));
        assert!(report.loss_warnings.iter().any(|w| w.contains("Locked production A/B page breaks")));
        assert!(report.cloud_workflow_guidance.contains("Google Drive"));
    }

    #[test]
    fn test_treatment_to_google_docs_capability() {
        let report = analyze_export_capability(
            DocumentProfile::TreatmentProse,
            TargetFormat::DocxGoogleDocs,
            false,
            false,
        );

        assert!(report.is_supported);
        assert_eq!(report.fidelity_grade, FidelityGrade::HighFidelity);
        assert!(report.loss_warnings.is_empty());
        assert!(report.cloud_workflow_guidance.contains("1:1 to word processor styles"));
    }

    #[test]
    fn test_screenplay_to_google_sheets_incompatible() {
        let report = analyze_export_capability(
            DocumentProfile::ScreenplayUs,
            TargetFormat::XlsxGoogleSheets,
            false,
            false,
        );

        assert!(!report.is_supported);
        assert_eq!(report.fidelity_grade, FidelityGrade::Incompatible);
        assert!(report.loss_warnings.iter().any(|w| w.contains("Script prose is dramatic narrative, not tabular data")));
        assert!(report.cloud_workflow_guidance.contains("StoryScry"));
    }

    #[test]
    fn test_interactive_to_google_docs_flattening() {
        let report = analyze_export_capability(
            DocumentProfile::InteractiveStory,
            TargetFormat::DocxGoogleDocs,
            false,
            false,
        );

        assert!(report.is_supported);
        assert_eq!(report.fidelity_grade, FidelityGrade::LossyStructural);
        assert!(report.loss_warnings.iter().any(|w| w.contains("flattened into linear reading text")));
    }
}
