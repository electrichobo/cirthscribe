//! Rolling backups of project files.
//!
//! Before a package is replaced, the current file is copied into the backup
//! folder as `<stem>--<YYYYMMDD-HHMMSS>Z--v<saved_version>.cirth`, unless:
//! - there is no current file yet, or
//! - the newest backup already holds the same saved version, or
//! - the newest backup is younger than `min_interval` (unless forced, as on
//!   an explicit Save).
//! Only the newest `keep` backups are kept. Backups are full, standalone
//! project files: restoring one means opening a copy of it.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug)]
pub struct BackupPolicy {
    pub dir: PathBuf,
    pub keep: usize,
    pub min_interval: Duration,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct BackupEntry {
    pub path: PathBuf,
    pub file_name: String,
    /// Seconds since the Unix epoch (UTC), parsed from the file name.
    pub created_s: u64,
    pub saved_version: u64,
}

/// `YYYY-MM-DD HH.MM UTC`, for file names people read (no colons, and the
/// time cannot be mistaken for a year).
pub fn readable_utc(secs: u64) -> String {
    let s = utc_stamp(secs);
    format!("{}-{}-{} {}.{} UTC", &s[0..4], &s[4..6], &s[6..8], &s[9..11], &s[11..13])
}

/// UTC civil date and time from Unix seconds (proleptic Gregorian).
pub fn utc_stamp(secs: u64) -> String {
    let days = (secs / 86_400) as i64;
    let rem = secs % 86_400;
    // Howard Hinnant's days-to-civil algorithm.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}{m:02}{d:02}-{:02}{:02}{:02}", rem / 3600, rem % 3600 / 60, rem % 60)
}

fn parse_stamp(s: &str) -> Option<u64> {
    // YYYYMMDD-HHMMSS
    let (date, time) = s.split_once('-')?;
    if date.len() != 8 || time.len() != 6 {
        return None;
    }
    let n = |t: &str| t.parse::<i64>().ok();
    let (y, m, d) = (n(&date[0..4])?, n(&date[4..6])?, n(&date[6..8])?);
    let (hh, mm, ss) = (n(&time[0..2])?, n(&time[2..4])?, n(&time[4..6])?);
    // Days-from-civil.
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some((days * 86_400 + hh * 3600 + mm * 60 + ss) as u64)
}

/// Backups of `stem`, newest first.
pub fn list(dir: &Path, stem: &str) -> Vec<BackupEntry> {
    let prefix = format!("{stem}--");
    let mut out: Vec<BackupEntry> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let file_name = e.file_name().to_string_lossy().to_string();
            let rest = file_name.strip_prefix(&prefix)?.strip_suffix(".cirth")?;
            // <stamp>Z--v<version>[-n]
            let (stamp, ver) = rest.split_once("Z--v")?;
            let created_s = parse_stamp(stamp)?;
            let saved_version = ver.split('-').next()?.parse().ok()?;
            Some(BackupEntry { path: e.path(), file_name: file_name.clone(), created_s, saved_version })
        })
        .collect();
    out.sort_by(|a, b| b.created_s.cmp(&a.created_s).then(b.saved_version.cmp(&a.saved_version)));
    out
}

/// Copy `current` into the backup folder if the policy calls for it, then
/// prune. Returns the new backup's path, if one was made.
pub fn before_replace(current: &Path, name: &str, saved_version: u64, policy: &BackupPolicy, now: SystemTime, force: bool) -> std::io::Result<Option<PathBuf>> {
    if !current.exists() {
        return Ok(None);
    }
    std::fs::create_dir_all(&policy.dir)?;
    let stem = name.to_string();
    let now_s = now.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs();
    let existing = list(&policy.dir, &stem);
    if let Some(newest) = existing.first() {
        let young = now_s.saturating_sub(newest.created_s) < policy.min_interval.as_secs();
        if newest.saved_version == saved_version || (young && !force) {
            return Ok(None);
        }
    }
    let mut name = format!("{stem}--{}Z--v{saved_version}.cirth", utc_stamp(now_s));
    // Two saves in the same second: never overwrite a backup.
    let mut n = 2;
    while policy.dir.join(&name).exists() {
        name = format!("{stem}--{}Z--v{saved_version}-{n}.cirth", utc_stamp(now_s));
        n += 1;
    }
    let target = policy.dir.join(&name);
    let tmp = target.with_extension("cirth.tmp");
    std::fs::copy(current, &tmp)?;
    crate::fsutil::sync_file(&tmp)?;
    crate::fsutil::replace_file(&tmp, &target)?;
    for old in list(&policy.dir, &stem).into_iter().skip(policy.keep) {
        std::fs::remove_file(old.path)?;
    }
    Ok(Some(target))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stamp_round_trips() {
        for s in [0u64, 951_782_400, 1_761_454_800, 4_102_444_799] {
            assert_eq!(parse_stamp(&utc_stamp(s)), Some(s), "{s} -> {}", utc_stamp(s));
        }
        assert_eq!(utc_stamp(951_782_400), "20000229-000000"); // leap day
        assert_eq!(readable_utc(1_761_510_361), "2025-10-26 20.26 UTC");
    }
}
