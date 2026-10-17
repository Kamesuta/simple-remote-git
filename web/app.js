// 画面の流れ:開く → 手元のログで即描画 → 裏でフェッチ → 終わったら取り直して描き直す。
// PWA に戻ってきたとき(visibilitychange)も同じ流れ。最後に見たリポは localStorage に覚える。
import { layout, render } from "./graph/graph.js";
import { ago, label, esc, rowHtml } from "./graph/rows.js";

const ROW = 64;
const LANE = 12;
const $ = (id) => document.getElementById(id);

let repos = [];
let current = null; // いま見ているリポ名
let seq = 0; // リポを切り替えたら古い応答を捨てるための番号
let fetchedAt = null;
let fetchState = { state: "idle", text: "" };

const store = {
  get: () => { try { return localStorage.getItem("repo"); } catch { return null; } },
  set: (v) => { try { localStorage.setItem("repo", v); } catch { /* 覚えられなくても動く */ } },
};

// ---- 状態の行 ----
function showStatus(state, text) {
  fetchState = { state, text };
  $("status").dataset.state = state;
  $("status-text").textContent = text;
}
function showFetched() {
  if (fetchState.state === "busy" || fetchState.state === "err") return;
  const when = fetchedAt && ago(fetchedAt);
  showStatus("done", !when ? "まだ取得していない" : when === "たった今" ? "たった今取得" : `${when}に取得`);
}

function draw(data) {
  const commits = data.commits;
  const lay = layout(commits);
  const heads = new Set(commits.flatMap((c, i) => (c.refs?.some((r) => r.t === "head") ? [i] : [])));
  const g = render(lay, { lane: LANE, row: ROW, heads });
  // グラフ列は画面幅の 40% で切る(それより広い分は隠れる)
  const pad = Math.max(24, Math.min(g.width, Math.floor(window.innerWidth * 0.4)));
  const svg = $("lanes");
  svg.setAttribute("width", g.width);
  svg.setAttribute("height", g.height);
  svg.innerHTML = g.markup;
  svg.parentElement.style.width = `${pad}px`;
  $("rows").innerHTML = commits.length
    ? commits.map((c) => rowHtml(c, pad, data.github)).join("")
    : '<p class="empty">コミットがまだありません</p>';
  const n = commits.filter((c) => c.kind === "commit").length;
  $("count").textContent = `${n} 件`;
}

// ---- データの流れ ----
async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok && !("ok" in body)) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

async function loadGraph(my) {
  const data = await api(`/api/graph?repo=${encodeURIComponent(current)}&limit=400`);
  if (my !== seq) return null;
  fetchedAt = data.fetchedAt;
  draw(data);
  return data;
}

async function refresh() {
  if (!current) return;
  const my = ++seq;
  try {
    const data = await loadGraph(my);
    if (!data) return;
    if (!data.remotes.length) return showStatus("done", "フェッチ先なし(remote がありません)");
    showStatus("busy", "取得中…");
    const res = await api(`/api/fetch?repo=${encodeURIComponent(current)}`, { method: "POST" });
    if (my !== seq) return;
    if (!res.ok) return showStatus("err", `取得できず: ${res.error}`);
    fetchState = { state: "idle" };
    await loadGraph(my);
    showFetched();
  } catch (e) {
    if (my === seq) showStatus("err", `読めませんでした: ${e.message}`);
  }
}

function select(name) {
  current = name;
  store.set(name);
  const r = repos.find((x) => x.name === name);
  $("repo-label").textContent = label(r);
  $("repo-path").textContent = `~/softdata/git/${r.name}`;
  document.title = `${label(r)} — Git Graph`;
  for (const b of $("repos").children) {
    b.setAttribute("aria-pressed", String(b.dataset.name === name));
    if (b.dataset.name === name) b.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  window.scrollTo(0, 0);
  $("rows").innerHTML = "";
  $("lanes").innerHTML = "";
  showStatus("busy", "読み込み中…");
  refresh();
}

async function start() {
  try {
    repos = await api("/api/repos");
  } catch (e) {
    return showStatus("err", `一覧を読めませんでした: ${e.message}`);
  }
  $("repos").innerHTML = repos.map((r) =>
    `<button type="button" data-name="${esc(r.name)}" aria-pressed="false">${esc(label(r))}</button>`).join("");
  if (!repos.length) return showStatus("err", "~/softdata/git に git リポが見つかりません");
  const last = store.get();
  select(repos.some((r) => r.name === last) ? last : repos[0].name);
}

$("repos").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b && b.dataset.name !== current) select(b.dataset.name);
});
// ---- テーマ(自動 → ライト → ダーク)。最初の判定は index.html の頭でしてある ----
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
$("theme").addEventListener("click", () => {
  const pick = NEXT[document.documentElement.dataset.pick] ?? "auto";
  try { localStorage.setItem("theme", pick); } catch { /* 覚えられなくても今は切り替わる */ }
  applyTheme(pick);
});
darkMq.addEventListener("change", () => applyTheme(document.documentElement.dataset.pick));
applyTheme(document.documentElement.dataset.pick ?? "auto");

$("refresh").addEventListener("click", refresh);
$("retry").addEventListener("click", refresh);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refresh(); });
setInterval(showFetched, 30000); // 「n 分前」を進める

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
start();
