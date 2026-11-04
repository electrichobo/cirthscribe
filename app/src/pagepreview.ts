// A small page beside the title page and header/footer fields, showing where
// the text will print. The core places every line (page_preview), as it does
// for the PDF; this only draws them to scale (the web view never measures pages).

import { invoke } from "@tauri-apps/api/core";

interface PagePreview {
  page_w_in: number;
  page_h_in: number;
  font_pt: number;
  lines: { x_in: number; y_in: number; text: string; role: string }[];
}

/** Pixels per inch in the preview. */
const SCALE = 38;

export function createPagePreview(label: string) {
  const page = document.createElement("div");
  page.className = "page-preview";
  page.setAttribute("role", "img");
  page.setAttribute("aria-label", label);
  let timer = 0;
  let seq = 0;

  async function draw(args: Record<string, unknown>) {
    const mine = ++seq;
    const profileName = (document.getElementById("profile") as HTMLSelectElement | null)?.value ?? "letter";
    let pv: PagePreview;
    try {
      pv = await invoke<PagePreview>("page_preview", { profileName, ...args });
    } catch {
      return;
    }
    if (mine !== seq) return;
    page.style.width = `${pv.page_w_in * SCALE}px`;
    page.style.height = `${pv.page_h_in * SCALE}px`;
    page.style.fontSize = `${(pv.font_pt * SCALE) / 72}px`;
    page.replaceChildren(
      ...pv.lines.map((l) => {
        const s = document.createElement("span");
        s.className = `pp-line pp-${l.role}`;
        s.textContent = l.text;
        s.style.left = `${l.x_in * SCALE}px`;
        s.style.top = `${l.y_in * SCALE}px`;
        return s;
      }),
    );
    page.dataset.lines = String(pv.lines.length);
  }

  return {
    el: page,
    /** Redraw soon (after typing settles). */
    update(args: Record<string, unknown>) {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void draw(args), 120);
    },
    now: (args: Record<string, unknown>) => draw(args),
  };
}
