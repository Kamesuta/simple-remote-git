// テーマ(自動 → ライト → ダーク)。最初の判定は index.html の頭でしてある(描く前に決めないと色がちらつくため)
const $ = (id) => document.getElementById(id);
const THEMES = { auto: "自動", light: "ライト", dark: "ダーク" };
const NEXT = { auto: "light", light: "dark", dark: "auto" };
const darkMq = matchMedia("(prefers-color-scheme: dark)");

function applyTheme(pick) {
  const dark = pick === "dark" || (pick === "auto" && darkMq.matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.pick = pick;
  $("theme-color").content = dark ? "#16191D" : "#FFFFFF";
  $("theme-label").textContent = THEMES[pick];
  $("theme").setAttribute("aria-label", `テーマ: ${THEMES[pick]}(押すと切り替え)`);
}

export function setupTheme() {
  $("theme").addEventListener("click", () => {
    const pick = NEXT[document.documentElement.dataset.pick] ?? "auto";
    try { localStorage.setItem("theme", pick); } catch { /* 覚えられなくても今は切り替わる */ }
    applyTheme(pick);
  });
  darkMq.addEventListener("change", () => applyTheme(document.documentElement.dataset.pick));
  applyTheme(document.documentElement.dataset.pick ?? "auto");
}
