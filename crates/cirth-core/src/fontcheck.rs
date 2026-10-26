//! Minimal TrueType reader: units per em, advance widths and cmap coverage.
//! Used to prove the fixed-pitch assumption and to report characters the
//! bundled font cannot draw, instead of letting a fallback font silently
//! change line widths.

fn u16_at(d: &[u8], o: usize) -> Option<u16> {
    Some(u16::from_be_bytes([*d.get(o)?, *d.get(o + 1)?]))
}
fn u32_at(d: &[u8], o: usize) -> Option<u32> {
    Some(u32::from_be_bytes([*d.get(o)?, *d.get(o + 1)?, *d.get(o + 2)?, *d.get(o + 3)?]))
}

fn table<'a>(d: &'a [u8], tag: &[u8; 4]) -> Option<&'a [u8]> {
    let n = u16_at(d, 4)? as usize;
    for i in 0..n {
        let rec = 12 + i * 16;
        if d.get(rec..rec + 4)? == tag {
            let off = u32_at(d, rec + 8)? as usize;
            let len = u32_at(d, rec + 12)? as usize;
            return d.get(off..off + len);
        }
    }
    None
}

pub struct FontInfo<'a> {
    data: &'a [u8],
    pub units_per_em: u16,
    cmap4: Option<&'a [u8]>,
    cmap12: Option<&'a [u8]>,
}

impl<'a> FontInfo<'a> {
    pub fn parse(data: &'a [u8]) -> Option<FontInfo<'a>> {
        let head = table(data, b"head")?;
        let units_per_em = u16_at(head, 18)?;
        let cmap = table(data, b"cmap")?;
        let (mut cmap4, mut cmap12) = (None, None);
        for i in 0..u16_at(cmap, 2)? as usize {
            let off = u32_at(cmap, 4 + i * 8 + 4)? as usize;
            let sub = cmap.get(off..)?;
            match u16_at(sub, 0)? {
                4 => cmap4 = cmap4.or(Some(sub)),
                12 => cmap12 = cmap12.or(Some(sub)),
                _ => {}
            }
        }
        Some(FontInfo { data, units_per_em, cmap4, cmap12 })
    }

    pub fn glyph(&self, c: char) -> u16 {
        let cp = c as u32;
        if let Some(t) = self.cmap12 {
            let n = u32_at(t, 12).unwrap_or(0) as usize;
            for i in 0..n {
                let g = 16 + i * 12;
                let (s, e, gid) = (u32_at(t, g).unwrap_or(0), u32_at(t, g + 4).unwrap_or(0), u32_at(t, g + 8).unwrap_or(0));
                if cp >= s && cp <= e {
                    return (gid + cp - s) as u16;
                }
            }
            return 0;
        }
        let Some(t) = self.cmap4 else { return 0 };
        if cp > 0xFFFF {
            return 0;
        }
        let segx2 = u16_at(t, 6).unwrap_or(0) as usize;
        for i in 0..segx2 / 2 {
            let end = u16_at(t, 14 + i * 2).unwrap_or(0) as u32;
            if cp > end {
                continue;
            }
            let start = u16_at(t, 16 + segx2 + i * 2).unwrap_or(0) as u32;
            if cp < start {
                return 0;
            }
            let delta = u16_at(t, 16 + 2 * segx2 + i * 2).unwrap_or(0);
            let ro_pos = 16 + 3 * segx2 + i * 2;
            let ro = u16_at(t, ro_pos).unwrap_or(0) as usize;
            if ro == 0 {
                return (cp as u16).wrapping_add(delta);
            }
            let gpos = ro_pos + ro + 2 * (cp - start) as usize;
            let g = u16_at(t, gpos).unwrap_or(0);
            return if g == 0 { 0 } else { g.wrapping_add(delta) };
        }
        0
    }

    pub fn advance(&self, glyph: u16) -> Option<u16> {
        let hhea = table(self.data, b"hhea")?;
        let n_hm = u16_at(hhea, 34)?;
        let hmtx = table(self.data, b"hmtx")?;
        let idx = glyph.min(n_hm - 1) as usize;
        u16_at(hmtx, idx * 4)
    }
}

/// Characters in `text` the font has no glyph for (excluding whitespace/controls).
pub fn missing_chars(font: &FontInfo, text: &str) -> Vec<char> {
    let mut out: Vec<char> = text.chars().filter(|c| !c.is_whitespace() && !c.is_control() && !matches!(*c, '\u{200D}' | '\u{FE0F}') && font.glyph(*c) == 0).collect();
    out.sort();
    out.dedup();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn courier_prime_is_fixed_pitch_at_ten_cpi() {
        for data in [crate::pdf::REGULAR, crate::pdf::BOLD, crate::pdf::ITALIC, crate::pdf::BOLD_ITALIC] {
            let f = FontInfo::parse(data).expect("font parses");
            let em = f.units_per_em as f32;
            for c in "Aa iW.M(—é".chars() {
                let g = f.glyph(c);
                assert_ne!(g, 0, "missing glyph for {c:?}");
                let adv = f.advance(g).unwrap() as f32 / em;
                // 0.6 em at 12 pt = 7.2 pt = 0.1 inch.
                assert!((adv - 0.6).abs() < 1e-3, "{c:?} advance {adv}");
            }
        }
    }

    #[test]
    fn reports_glyphs_courier_prime_lacks() {
        let f = FontInfo::parse(crate::pdf::REGULAR).unwrap();
        let missing = missing_chars(&f, "Café 漢字 שלום 👍");
        assert!(missing.contains(&'漢'));
        assert!(missing.contains(&'👍'));
        assert!(!missing.contains(&'é'));
    }
}
