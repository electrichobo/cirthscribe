// Software Tour Onboarding Dialog for Kolbítar.
// Guides writers through key features with step-by-step illustrated cards.
// Non-blocking, keyboard-accessible, and re-launchable via Help > Software Tour…

import { announce } from "./a11y";

export interface TourStep {
  title: string;
  tagline: string;
  description: string;
  badge: string;
  placeholderSvg: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    title: "Distraction-Free Screenplay Writing",
    tagline: "Courier Prime 12 pt, Authoritative Layout & Smart Cycles",
    description:
      "Write standard feature screenplays with authoritative 55 lines/page pagination. Use Tab and Enter to naturally cycle between Scene Headings, Action, Character Cues, Dialogue, and Parentheticals. Press Ctrl/Cmd+D for seamless dual dialogue.",
    badge: "1. The Writing Canvas",
    placeholderSvg: `
      <rect x="20" y="15" width="280" height="150" rx="6" fill="var(--bg-muted, #f8f8f8)" stroke="var(--border, #ccc)" stroke-width="1.5"/>
      <rect x="35" y="30" width="160" height="12" rx="3" fill="#666"/>
      <rect x="35" y="52" width="250" height="8" rx="2" fill="#999"/>
      <rect x="35" y="66" width="220" height="8" rx="2" fill="#999"/>
      <rect x="120" y="90" width="80" height="10" rx="3" fill="#444"/>
      <rect x="75" y="108" width="170" height="8" rx="2" fill="#777"/>
      <rect x="85" y="122" width="150" height="8" rx="2" fill="#777"/>
      <text x="160" y="152" font-size="11" font-family="Courier Prime, monospace" fill="#888" text-anchor="middle">SCENE HEADING • ACTION • DIALOGUE</text>
    `,
  },
  {
    title: "Floating Island Toolbar & Writing Modes",
    tagline: "Focus Mode, Typewriter Scrolling & Minimal Chrome",
    description:
      "The compact island toolbar stays centered over your page. Enter Focus Mode (Ctrl/Cmd+Shift+F) to hide all interface chrome, or toggle Typewriter Mode (Ctrl/Cmd+Shift+T) to keep your active typing line vertically centered as you write.",
    badge: "2. Focus & Ergonomics",
    placeholderSvg: `
      <rect x="20" y="20" width="280" height="140" rx="6" fill="var(--bg-muted, #f8f8f8)" stroke="var(--border, #ccc)" stroke-width="1.5"/>
      <rect x="50" y="45" width="220" height="34" rx="17" fill="var(--bg, #fff)" stroke="var(--border, #bbb)" stroke-width="1.5"/>
      <circle cx="75" cy="62" r="8" fill="#555"/>
      <rect x="95" y="58" width="25" height="8" rx="2" fill="#777"/>
      <rect x="130" y="58" width="25" height="8" rx="2" fill="#777"/>
      <rect x="165" y="58" width="40" height="8" rx="2" fill="#4a7c59"/>
      <circle cx="245" cy="62" r="8" fill="#555"/>
      <line x1="35" y1="110" x2="285" y2="110" stroke="#4a7c59" stroke-width="2" stroke-dasharray="4 4"/>
      <text x="160" y="132" font-size="11" font-family="system-ui, sans-serif" fill="#666" text-anchor="middle">Centered Typewriter Line</text>
    `,
  },
  {
    title: "Story Planning Suite & Shared Bible",
    tagline: "Navigator, Outline Editor, Beat Pacing & World Bible",
    description:
      "Organize your story across Acts, Sequences, and Beats in the Outline view. Explore characters and locations in the shared Project Bible with automatic alias detection. The beat board estimates pacing against target page lengths.",
    badge: "3. Planning & World Bible",
    placeholderSvg: `
      <rect x="20" y="20" width="85" height="140" rx="4" fill="var(--bg-muted, #f0f0f0)" stroke="var(--border, #ccc)"/>
      <rect x="28" y="32" width="69" height="10" rx="2" fill="#555"/>
      <rect x="28" y="48" width="55" height="7" rx="2" fill="#888"/>
      <rect x="28" y="60" width="60" height="7" rx="2" fill="#888"/>
      <rect x="115" y="20" width="185" height="140" rx="6" fill="var(--bg, #fff)" stroke="var(--border, #ccc)"/>
      <rect x="130" y="35" width="70" height="40" rx="4" fill="#e8f0fe" stroke="#4285f4"/>
      <rect x="210" y="35" width="75" height="40" rx="4" fill="#fce8e6" stroke="#ea4335"/>
      <rect x="130" y="85" width="155" height="60" rx="4" fill="#e6f4ea" stroke="#34a853"/>
      <text x="207" y="118" font-size="11" font-family="system-ui, sans-serif" fill="#2d6a4f" text-anchor="middle">Project Bible & Beats</text>
    `,
  },
  {
    title: "Production Tools: StoryScry & Stripboard",
    tagline: "Script Breakdowns, Shooting Schedules & Actor Sides",
    description:
      "Tag props, wardrobe, vehicles, and stunts with provenance. Visualize dialogue pacing, interior/exterior distribution, and cast presence on the StoryScry dashboard. Plan shoot days on the vertical stripboard and export actor sides.",
    badge: "4. Production & Scheduling",
    placeholderSvg: `
      <rect x="20" y="20" width="280" height="140" rx="6" fill="var(--bg-muted, #f8f8f8)" stroke="var(--border, #ccc)" stroke-width="1.5"/>
      <circle cx="85" cy="85" r="42" fill="none" stroke="#ddd" stroke-width="14"/>
      <path d="M 85 43 A 42 42 0 0 1 127 85 L 85 85 Z" fill="#4285f4"/>
      <path d="M 127 85 A 42 42 0 0 1 85 127 L 85 85 Z" fill="#34a853"/>
      <rect x="155" y="40" width="130" height="20" rx="3" fill="#fef7e0" stroke="#fbbc04"/>
      <rect x="155" y="66" width="130" height="20" rx="3" fill="#e8f0fe" stroke="#4285f4"/>
      <rect x="155" y="92" width="130" height="20" rx="3" fill="#fce8e6" stroke="#ea4335"/>
      <text x="220" y="132" font-size="11" font-family="system-ui, sans-serif" fill="#666" text-anchor="middle">Stripboard & Schedule</text>
    `,
  },
  {
    title: "Non-Destructive Versions & Alternatives",
    tagline: "A-Pages, Alternative Takes, Snapshots & Branches",
    description:
      "Lock production scene numbers and paginate revision sets with colored A-pages. Try dialogue variations with block Alternative Takes (`Take 1/2 ▾`), save named SQLite checkpoints, and explore experimental story drafts on independent branches.",
    badge: "5. Revisions & Takes",
    placeholderSvg: `
      <rect x="20" y="20" width="280" height="140" rx="6" fill="var(--bg-muted, #f8f8f8)" stroke="var(--border, #ccc)" stroke-width="1.5"/>
      <rect x="40" y="35" width="240" height="30" rx="4" fill="var(--bg, #fff)" stroke="#999"/>
      <rect x="50" y="44" width="70" height="12" rx="3" fill="#3b82f6"/>
      <text x="85" y="53" font-size="9" fill="#fff" text-anchor="middle" font-family="system-ui, sans-serif">Take 1/2 ▾</text>
      <rect x="130" y="46" width="130" height="8" rx="2" fill="#777"/>
      <path d="M 60 95 C 100 95, 120 125, 160 125 L 260 125" fill="none" stroke="#10b981" stroke-width="2.5"/>
      <circle cx="60" cy="95" r="5" fill="#10b981"/>
      <circle cx="160" cy="125" r="5" fill="#10b981"/>
      <circle cx="260" cy="125" r="5" fill="#10b981"/>
      <text x="210" y="112" font-size="11" font-family="monospace" fill="#059669">🌿 feature-branch</text>
    `,
  },
  {
    title: "Multi-Format, Offline Grammar & Optional AI",
    tagline: "Comics, Stage Plays, Branching, Offline Analysis & Diff AI",
    description:
      "Switch between Graphic Novels, Sitcoms, Stage Plays, and Branching Stories. Catch passive voice and dialogue punctuation with our 100% offline rule-based grammar engine. Optionally bring your own local AI with transparent scope disclosure and non-destructive diffs.",
    badge: "6. Formats & Intelligence",
    placeholderSvg: `
      <rect x="20" y="20" width="280" height="140" rx="6" fill="var(--bg-muted, #f8f8f8)" stroke="var(--border, #ccc)" stroke-width="1.5"/>
      <rect x="35" y="35" width="115" height="48" rx="4" fill="#fdf2f8" stroke="#ec4899"/>
      <text x="92" y="55" font-size="10" fill="#be185d" text-anchor="middle" font-family="system-ui, sans-serif">Comic / Graphic Novel</text>
      <rect x="165" y="35" width="120" height="48" rx="4" fill="#eff6ff" stroke="#3b82f6"/>
      <text x="225" y="55" font-size="10" fill="#1d4ed8" text-anchor="middle" font-family="system-ui, sans-serif">Interactive Branching</text>
      <rect x="35" y="95" width="250" height="48" rx="4" fill="#f0fdf4" stroke="#22c55e"/>
      <text x="160" y="117" font-size="10" fill="#15803d" text-anchor="middle" font-family="system-ui, sans-serif">100% Offline Grammar • Non-Destructive Diffs</text>
    `,
  },
];

export function createTourDialog() {
  const dialog = document.createElement("dialog");
  dialog.id = "tour-dialog";
  dialog.className = "about tour-dialog form-dialog";
  dialog.setAttribute("aria-labelledby", "tour-dialog-title");
  dialog.style.maxWidth = "560px";
  dialog.style.width = "90vw";
  dialog.style.padding = "0";
  dialog.style.borderRadius = "8px";
  dialog.style.border = "1px solid var(--border, #ccc)";
  dialog.style.boxShadow = "0 12px 32px rgba(0,0,0,0.2)";

  let currentStep = 0;

  const container = document.createElement("div");
  container.className = "tour-container";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.width = "100%";

  // Visual header area
  const visualHeader = document.createElement("div");
  visualHeader.className = "tour-visual-header";
  visualHeader.style.padding = "20px 20px 10px 20px";
  visualHeader.style.background = "var(--bg-secondary, #fafafa)";
  visualHeader.style.borderBottom = "1px solid var(--border-light, #eee)";
  visualHeader.style.textAlign = "center";

  const svgWrap = document.createElement("div");
  svgWrap.id = "tour-svg-wrap";
  svgWrap.style.width = "100%";
  svgWrap.style.maxHeight = "170px";
  svgWrap.style.display = "flex";
  svgWrap.style.justifyContent = "center";

  visualHeader.appendChild(svgWrap);

  // Content body
  const body = document.createElement("div");
  body.className = "tour-body";
  body.style.padding = "16px 24px";

  const badgeEl = document.createElement("span");
  badgeEl.id = "tour-badge";
  badgeEl.className = "badge";
  badgeEl.style.fontSize = "0.75rem";
  badgeEl.style.textTransform = "uppercase";
  badgeEl.style.letterSpacing = "0.5px";
  badgeEl.style.padding = "3px 8px";
  badgeEl.style.borderRadius = "12px";
  badgeEl.style.background = "var(--accent-muted, #e0e7ff)";
  badgeEl.style.color = "var(--accent, #3b82f6)";
  badgeEl.style.fontWeight = "600";
  badgeEl.style.marginBottom = "8px";
  badgeEl.style.display = "inline-block";

  const titleEl = document.createElement("h2");
  titleEl.id = "tour-dialog-title";
  titleEl.style.margin = "4px 0 6px 0";
  titleEl.style.fontSize = "1.25rem";
  titleEl.style.lineHeight = "1.3";

  const taglineEl = document.createElement("div");
  taglineEl.id = "tour-tagline";
  taglineEl.style.fontSize = "0.9rem";
  taglineEl.style.fontWeight = "bold";
  taglineEl.style.color = "var(--fg-muted, #666)";
  taglineEl.style.marginBottom = "10px";

  const descEl = document.createElement("p");
  descEl.id = "tour-desc";
  descEl.style.fontSize = "0.95rem";
  descEl.style.lineHeight = "1.5";
  descEl.style.color = "var(--fg, #222)";
  descEl.style.margin = "0 0 16px 0";

  body.append(badgeEl, titleEl, taglineEl, descEl);

  // Footer controls
  const foot = document.createElement("div");
  foot.className = "tour-foot";
  foot.style.display = "flex";
  foot.style.alignItems = "center";
  foot.style.justifyContent = "space-between";
  foot.style.padding = "12px 24px 18px 24px";
  foot.style.borderTop = "1px solid var(--border-light, #eee)";

  const dotsContainer = document.createElement("div");
  dotsContainer.className = "tour-dots";
  dotsContainer.style.display = "flex";
  dotsContainer.style.gap = "6px";

  for (let i = 0; i < TOUR_STEPS.length; i++) {
    const dot = document.createElement("span");
    dot.className = `tour-dot tour-dot-${i}`;
    dot.style.width = "8px";
    dot.style.height = "8px";
    dot.style.borderRadius = "50%";
    dot.style.background = i === 0 ? "var(--accent, #3b82f6)" : "var(--border, #ccc)";
    dot.style.transition = "all 0.2s ease";
    dotsContainer.appendChild(dot);
  }

  const buttonsRow = document.createElement("div");
  buttonsRow.style.display = "flex";
  buttonsRow.style.gap = "8px";

  const btnSkip = document.createElement("button");
  btnSkip.type = "button";
  btnSkip.id = "tour-btn-skip";
  btnSkip.className = "btn";
  btnSkip.textContent = "Skip Tour";

  const btnPrev = document.createElement("button");
  btnPrev.type = "button";
  btnPrev.id = "tour-btn-prev";
  btnPrev.className = "btn";
  btnPrev.textContent = "Previous";
  btnPrev.disabled = true;

  const btnNext = document.createElement("button");
  btnNext.type = "button";
  btnNext.id = "tour-btn-next";
  btnNext.className = "btn btn-primary";
  btnNext.textContent = "Next";

  buttonsRow.append(btnSkip, btnPrev, btnNext);
  foot.append(dotsContainer, buttonsRow);

  container.append(visualHeader, body, foot);
  dialog.appendChild(container);
  document.body.appendChild(dialog);

  function renderStep(idx: number) {
    currentStep = Math.max(0, Math.min(idx, TOUR_STEPS.length - 1));
    const step = TOUR_STEPS[currentStep];

    badgeEl.textContent = step.badge;
    titleEl.textContent = step.title;
    taglineEl.textContent = step.tagline;
    descEl.textContent = step.description;

    svgWrap.innerHTML = `
      <svg viewBox="0 0 320 180" width="320" height="180" style="max-width: 100%; height: auto;" role="img" aria-label="${step.title}">
        ${step.placeholderSvg}
      </svg>
    `;

    // Update dots
    const dots = dotsContainer.querySelectorAll(".tour-dot");
    dots.forEach((d, i) => {
      (d as HTMLElement).style.background = i === currentStep ? "var(--accent, #3b82f6)" : "var(--border, #ccc)";
      (d as HTMLElement).style.transform = i === currentStep ? "scale(1.25)" : "scale(1.0)";
    });

    btnPrev.disabled = currentStep === 0;
    if (currentStep === TOUR_STEPS.length - 1) {
      btnNext.textContent = "Get Started";
      btnSkip.style.display = "none";
    } else {
      btnNext.textContent = "Next";
      btnSkip.style.display = "inline-block";
    }

    announce(`${step.title}, step ${currentStep + 1} of ${TOUR_STEPS.length}`);
  }

  function markCompleted() {
    try {
      localStorage.setItem("cirth_tour_completed", "true");
    } catch {
      // Ignored if local storage unavailable
    }
  }

  btnPrev.onclick = () => {
    if (currentStep > 0) renderStep(currentStep - 1);
  };

  btnNext.onclick = () => {
    if (currentStep < TOUR_STEPS.length - 1) {
      renderStep(currentStep + 1);
    } else {
      markCompleted();
      dialog.close();
    }
  };

  btnSkip.onclick = () => {
    markCompleted();
    dialog.close();
  };

  dialog.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      btnNext.click();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      btnPrev.click();
    } else if (e.key === "Tab" || e.key === "ISO_Left_Tab" || e.keyCode === 9) {
      const stops = [btnSkip, btnPrev, btnNext].filter((b) => b.style.display !== "none" && !b.disabled);
      if (stops.length > 0) {
        const at = stops.indexOf(document.activeElement as HTMLButtonElement);
        const back = e.shiftKey || e.key === "ISO_Left_Tab";
        if (at === -1) {
          e.preventDefault();
          stops[back ? stops.length - 1 : 0].focus();
        } else if (back && at === 0) {
          e.preventDefault();
          stops[stops.length - 1].focus();
        } else if (!back && at === stops.length - 1) {
          e.preventDefault();
          stops[0].focus();
        }
      }
    }
  });

  return {
    dialog,
    open: (forceReset = false) => {
      if (forceReset) currentStep = 0;
      renderStep(currentStep);
      dialog.classList.remove("hidden");
      if (!dialog.open) dialog.showModal();
    },
    close: () => {
      dialog.close();
    },
    maybeAutoOpen: () => {
      try {
        if (navigator.webdriver) return;
        if (localStorage.getItem("cirth_tour_completed") !== "true") {
          // Delay briefly so initial project layout renders smoothly first
          setTimeout(() => {
            renderStep(0);
            dialog.classList.remove("hidden");
            if (!dialog.open) dialog.showModal();
          }, 450);
        }
      } catch {
        // Fallback: don't force
      }
    },
  };
}
