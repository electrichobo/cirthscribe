// Software Tour Onboarding Dialog for Kolbítar.
// Guides writers through the main tools, one card each: mostly what the tool
// is for, then how to reach it. Every colour comes from the theme (styles.css,
// .tour-*), and each card's picture is the tool's own icon (icons.ts), so the
// tour reads on light, dark and high-contrast themes alike.
// Non-blocking, keyboard-accessible, and re-launchable via Help > Software Tour…

import { announce } from "./a11y";
import { icon } from "./icons";

export interface TourStep {
  badge: string;
  title: string;
  /** What the tool is for (about three quarters of the card). */
  about: string;
  /** How to reach and use it (the last quarter). */
  how: string;
  /** Icon registry name shown as the card's picture. */
  icon: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    badge: "1. The Writing Page",
    title: "A screenplay page that formats itself",
    about:
      "Everything in Kolbítar grows from one standard page: Courier Prime 12 pt, industry margins, roughly a minute of screen time per page. Scene headings, action, character cues, dialogue and transitions take their proper place as you type, character names and locations autocomplete, and the page breaks you see are the ones that print.",
    how: "Tab and Enter move between elements; Ctrl/Cmd+D sets dual dialogue. Ctrl/Cmd+K jumps to any scene, character or command.",
    icon: "scenes",
  },
  {
    badge: "2. Notecard View",
    title: "See the shape of your story",
    about:
      "Every scene becomes a card with a logline and a summary you write, arranged in acts. A pacing strip shows how long each act runs, so you can spot a sagging middle before you rewrite it. Cards are planning, not a second copy of the script: editing a card never changes your pages.",
    how: "Open it with the Notecard View button on the toolbar. Drag cards to reorder; the script follows only if you turn that on.",
    icon: "board",
  },
  {
    badge: "3. The Story Bible",
    title: "One bible for your whole world",
    about:
      "Characters, locations and world details live in a single bible shared by every episode of a series. Kolbítar suggests entries from the script, knows that \"BOB\" and \"ROBERT\" can be the same person, and shows you every change before a rename touches the script. Each entry lists where it appears.",
    how: "Tools > Bible…. Add your own fields to any entry.",
    icon: "bible",
  },
  {
    badge: "4. Cork Board",
    title: "Work out how it all connects",
    about:
      "A free board for the messy part of story work: pin notes, pictures, scenes, beats and bible entries, and join them with labelled strings. Use it for mysteries, character relationships, research, or anything that is easier to see than to list.",
    how: "Tools > Cork Board…. Add a card, then drag from one card to another to draw a string.",
    icon: "evidence",
  },
  {
    badge: "5. Timeline",
    title: "Story order, not just page order",
    about:
      "Scripts jump around in time; the timeline keeps the events in the order they actually happen. Link events to scenes, mark flashbacks, and see a series' story laid out end to end. When you want, Kolbítar can preview putting the script into story order.",
    how: "Tools > Timeline….",
    icon: "timeline",
  },
  {
    badge: "6. StoryScry",
    title: "Your script, measured",
    about:
      "StoryScry turns the script into charts: who speaks and how much, who is present but silent, interior against exterior, day against night, scene lengths, revisions and breakdown tags. Each chart opens into a full report you can export. Running times are labelled as estimates.",
    how: "The StoryScry button on the toolbar, or Tools > StoryScry…. Choose a chart to open its report.",
    icon: "storyscry",
  },
  {
    badge: "7. Production",
    title: "From script to shooting schedule",
    about:
      "Tag props, wardrobe, cast and more straight in the script, and every report and schedule follows. The stripboard turns scenes into strips you arrange into shoot days, and character sides give each actor just their scenes.",
    how: "Select text and choose Tools > Breakdown Tags…; Tools > Stripboard… for the schedule.",
    icon: "stripboard",
  },
  {
    badge: "8. Revisions & Versions",
    title: "Change it without losing it",
    about:
      "Production revisions use the standard colour order, locked pages keep page numbers stable with A and B pages, and scene numbers lock separately. Snapshots save a moment you can return to, branches let you try another direction, and alternate takes keep variations of a line side by side. Autosave and backups run underneath it all.",
    how: "File > Snapshots…; Tools > Branches…; Format > Revisions for revision sets and locked pages.",
    icon: "snapshot",
  },
  {
    badge: "9. Feedback",
    title: "Notes that stay with the words",
    about:
      "Feedback is tied to the exact text it is about, with replies and resolved threads, and it follows the text through rewrites. Share it as a review package so a reader can add their notes without ever getting your whole project.",
    how: "The Feedback button on the toolbar; File > Export Review Package… to send a script for notes.",
    icon: "comment",
  },
  {
    badge: "10. Write Your Way",
    title: "Thoughts, focus, and every format",
    about:
      "Thoughts is a scratchpad that travels with the project, and Free Writing holds ideas that belong to no project yet. Focus mode clears the screen and typewriter mode keeps your line centred. Beyond screenplays there are stage plays, multi-camera TV, comics, interactive stories and treatments, with an offline grammar check. An AI assistant is available if you want one; it is off until you turn it on, and nothing leaves your computer otherwise.",
    how: "View > Mode for focus and typewriter; File > New Project… to pick a format.",
    icon: "focus",
  },
];

export function createTourDialog() {
  const dialog = document.createElement("dialog");
  dialog.id = "tour-dialog";
  dialog.className = "about tour-dialog form-dialog";
  dialog.setAttribute("aria-labelledby", "tour-dialog-title");

  let currentStep = 0;

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, id?: string): HTMLElementTagNameMap[K] => {
    const e = document.createElement(tag);
    e.className = cls;
    if (id) e.id = id;
    return e;
  };

  const picture = el("div", "tour-picture", "tour-svg-wrap");
  const badgeEl = el("span", "tour-badge", "tour-badge");
  const titleEl = el("h2", "tour-title", "tour-dialog-title");
  const aboutEl = el("p", "tour-about", "tour-desc");
  const howEl = el("p", "tour-how", "tour-how");
  const body = el("div", "tour-body");
  body.append(badgeEl, titleEl, aboutEl, howEl);

  const dotsContainer = el("div", "tour-dots");
  for (let i = 0; i < TOUR_STEPS.length; i++) dotsContainer.appendChild(el("span", `tour-dot tour-dot-${i}`));

  const button = (id: string, text: string, primary = false) => {
    const b = el("button", primary ? "btn btn-primary" : "btn", id);
    b.type = "button";
    b.textContent = text;
    return b;
  };
  const btnSkip = button("tour-btn-skip", "Skip Tour");
  const btnPrev = button("tour-btn-prev", "Previous");
  const btnNext = button("tour-btn-next", "Next", true);
  btnPrev.disabled = true;
  const buttonsRow = el("div", "tour-buttons");
  buttonsRow.append(btnSkip, btnPrev, btnNext);
  const foot = el("div", "tour-foot");
  foot.append(dotsContainer, buttonsRow);

  const container = el("div", "tour-container");
  container.append(picture, body, foot);
  dialog.appendChild(container);
  document.body.appendChild(dialog);

  function renderStep(idx: number) {
    currentStep = Math.max(0, Math.min(idx, TOUR_STEPS.length - 1));
    const step = TOUR_STEPS[currentStep];

    badgeEl.textContent = step.badge;
    titleEl.textContent = step.title;
    aboutEl.textContent = step.about;
    howEl.textContent = step.how;

    const art = icon(step.icon);
    art.setAttribute("width", "96");
    art.setAttribute("height", "96");
    picture.replaceChildren(art);

    dotsContainer.querySelectorAll(".tour-dot").forEach((d, i) => d.classList.toggle("current", i === currentStep));

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
    steps: TOUR_STEPS.length,
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
