//! Crash-safe file replacement.
//!
//! `replace_file(tmp, dest)` moves a fully written and flushed temp file over
//! the destination so that, after a crash or power loss, `dest` is either the
//! old file or the new one, never a mix. Windows: `MoveFileExW` with
//! `MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH` (the move is flushed
//! before the call returns). Unix: `rename`, then fsync of the directory so
//! the new directory entry is durable.

use std::io;
use std::path::Path;

/// Flush a file's contents to disk. Needs a writable handle on Windows.
pub fn sync_file(path: &Path) -> io::Result<()> {
    std::fs::OpenOptions::new().write(true).open(path)?.sync_all()
}

#[cfg(windows)]
pub fn replace_file(from: &Path, to: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn MoveFileExW(existing: *const u16, new: *const u16, flags: u32) -> i32;
    }
    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;
    let wide = |p: &Path| p.as_os_str().encode_wide().chain(Some(0)).collect::<Vec<u16>>();
    let (a, b) = (wide(from), wide(to));
    // SAFETY: both arguments are NUL-terminated UTF-16 strings that outlive the call.
    let ok = unsafe { MoveFileExW(a.as_ptr(), b.as_ptr(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) };
    if ok == 0 { Err(io::Error::last_os_error()) } else { Ok(()) }
}

#[cfg(not(windows))]
pub fn replace_file(from: &Path, to: &Path) -> io::Result<()> {
    std::fs::rename(from, to)?;
    let dir = to.parent().filter(|d| !d.as_os_str().is_empty()).unwrap_or(Path::new("."));
    std::fs::File::open(dir)?.sync_all()
}

/// What a file looked like when we last read or wrote it, to detect changes
/// made outside CirthScribe (sync tools, other programs, a copy pasted over
/// it). Size and modified time are a fast first check; the content hash
/// decides, so a rewrite with identical bytes is not a change.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileStamp {
    pub len: u64,
    pub modified_ns: u128,
    pub hash: u64,
}

/// FNV-1a 64-bit: a fast non-cryptographic content fingerprint.
pub fn fnv1a(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

fn modified_ns(meta: &std::fs::Metadata) -> u128 {
    meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_nanos()).unwrap_or(0)
}

impl FileStamp {
    pub fn of(path: &Path) -> io::Result<FileStamp> {
        let bytes = std::fs::read(path)?;
        let meta = std::fs::metadata(path)?;
        Ok(FileStamp { len: bytes.len() as u64, modified_ns: modified_ns(&meta), hash: fnv1a(&bytes) })
    }

    /// Has the file at `path` changed since this stamp? A missing file counts
    /// as changed.
    pub fn changed(&self, path: &Path) -> io::Result<bool> {
        let meta = match std::fs::metadata(path) {
            Ok(m) => m,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(true),
            Err(e) => return Err(e),
        };
        if meta.len() == self.len && modified_ns(&meta) == self.modified_ns {
            return Ok(false);
        }
        Ok(fnv1a(&std::fs::read(path)?) != self.hash)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_stamp_detects_content_changes_not_touches() {
        let d = std::env::temp_dir().join(format!("cirth-stamp-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let p = d.join("p.cirth");
        std::fs::write(&p, b"version one").unwrap();
        let s = FileStamp::of(&p).unwrap();
        assert!(!s.changed(&p).unwrap());
        // Same bytes rewritten later (sync tools do this): not a change.
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(&p, b"version one").unwrap();
        assert!(!s.changed(&p).unwrap());
        // Same length, different bytes: a change.
        std::fs::write(&p, b"version two").unwrap();
        assert!(s.changed(&p).unwrap());
        std::fs::remove_file(&p).unwrap();
        assert!(s.changed(&p).unwrap(), "a deleted file counts as changed");
    }

    #[test]
    fn replaces_existing_file_and_leaves_no_temp() {
        let d = std::env::temp_dir().join(format!("cirth-fsutil-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        let (tmp, dest) = (d.join("a.tmp"), d.join("a.cirth"));
        std::fs::write(&dest, b"old").unwrap();
        std::fs::write(&tmp, b"new").unwrap();
        sync_file(&tmp).unwrap();
        replace_file(&tmp, &dest).unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), b"new");
        assert!(!tmp.exists());
        // Also works when the destination does not exist yet.
        std::fs::write(&tmp, b"first").unwrap();
        replace_file(&tmp, &d.join("b.cirth")).unwrap();
        assert_eq!(std::fs::read(d.join("b.cirth")).unwrap(), b"first");
    }
}
