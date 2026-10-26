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

#[cfg(test)]
mod tests {
    use super::*;

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
