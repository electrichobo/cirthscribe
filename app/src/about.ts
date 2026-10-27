// About and licences: the attribution and copyright, the GPL notice, the full
// GPL text and every bundled third-party license. These are the "Appropriate
// Legal Notices" of GPL section 5(d); the attribution must stay (see NOTICE).

import { invoke } from "@tauri-apps/api/core";

interface AboutInfo {
  version: string;
  notice: string;
  license: string;
  third_party: string;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids);
  return e;
};

export function createAbout() {
  const dialog = el("dialog", { className: "about", id: "about-dialog" });
  dialog.setAttribute("aria-label", "About CirthScribe and licences");
  document.body.append(dialog);
  let info: AboutInfo | null = null;

  const tabs = [
    { id: "about", label: "About" },
    { id: "gpl", label: "GNU GPL v3" },
    { id: "third", label: "Third-party licences" },
  ] as const;
  type Tab = (typeof tabs)[number]["id"];

  function page(tab: Tab, i: AboutInfo): HTMLElement {
    if (tab === "gpl") return el("pre", { className: "about-text", tabIndex: 0, ariaLabel: "GNU General Public License version 3, full text" }, i.license);
    if (tab === "third") return el("pre", { className: "about-text", tabIndex: 0, ariaLabel: "Third-party licences, full text" }, i.third_party);
    return el(
      "div",
      { className: "about-main" },
      el("p", { className: "about-attribution" }, "Based on CirthScribe by Jared Hoy"),
      el("p", {}, "Copyright © 2026 Jared Hoy (electrichobo)"),
      el("p", {}, "Source code: ", el("span", { className: "about-url" }, "https://github.com/electrichobo/cirthscribe")),
      el(
        "p",
        {},
        "CirthScribe is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License, version 3 only, with an additional attribution term under section 7(b). ",
        el("strong", {}, "It comes with absolutely no warranty."),
        " See the GNU GPL v3 tab for details.",
      ),
      el("p", {}, "CirthScribe works offline. It sends nothing about you or your writing anywhere."),
      el("h3", {}, "Notice"),
      el("pre", { className: "about-text short", tabIndex: 0, ariaLabel: "Notice, full text" }, i.notice),
    );
  }

  function show(tab: Tab) {
    if (!info) return;
    const bar = el("div", { className: "about-tabs", role: "tablist" });
    for (const t of tabs) {
      const b = el("button", { type: "button", role: "tab", className: t.id === tab ? "current" : "" }, t.label);
      b.setAttribute("aria-selected", String(t.id === tab));
      b.dataset.aboutTab = t.id;
      b.addEventListener("click", () => show(t.id));
      bar.append(b);
    }
    const close = el("button", { type: "button", id: "about-close" }, "Close");
    close.addEventListener("click", () => dialog.close());
    dialog.replaceChildren(
      el("h2", { id: "about-title" }, "CirthScribe ", el("span", { className: "about-version" }, `version ${info.version}`)),
      bar,
      el("div", { className: "about-page", role: "tabpanel" }, page(tab, info)),
      el("div", { className: "dialog-actions" }, close),
    );
    dialog.dataset.tab = tab;
  }

  async function open(tab: Tab = "about") {
    info ??= await invoke<AboutInfo>("about_info");
    show(tab);
    if (!dialog.open) dialog.showModal();
  }

  return { open, close: () => dialog.close() };
}
