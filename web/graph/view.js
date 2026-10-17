// グラフのタブ。開く → 手元のログで即描画 → 裏でフェッチ → 終わったら取り直して描き直す。
// PWA に戻ってきたとき(visibilitychange)も同じ流れ。行のタップは app.js が # に変えて受ける。
import { api, forget, q } from "../lib/api.js";
import { layout, render } from "./graph.js";
import { ago, rowHtml } from "./rows.js";

const ROW = 64;
const LANE = 12;
const $ = (id) => document.getElementById(id);

let current = null; // いま描いているリポ名
let data = null; // いま描いているグラフ(詳細のシートがチップと未プッシュを借りる)
let seq = 0; // リポを切り替えたら古い応答を捨てるための番号
let fetchState = { state: "idle", text: "" };

// ---- 状態の行 ----
function showStatus(state, text) {
  fetchState = { state, text };
  $("status").dataset.state = state;
  $("status-text").textContent = text;
}
export function showFetched() {
  if (fetchState.state === "busy" || fetchState.state === "err") return;
  const when = data?.fetchedAt && ago(data.fetchedAt);
  showStatus("done", !when ? "まだ取得していない" : when === "たった今" ? "たった今取得" : `${when}に取得`);
}

function draw(d) {
  const commits = d.commits;
  const heads = new Set(commits.flatMap((c, i) => (c.refs?.some((r) => r.t === "head") ? [i] : [])));
  const g = render(layout(commits), { lane: LANE, row: ROW, heads });
  // グラフ列は画面幅の 40% で切る(それより広い分は隠れる)
  const pad = Math.max(24, Math.min(g.width, Math.floor(window.innerWidth * 0.4)));
  const svg = $("lanes");
  svg.setAttribute("width", g.width);
  svg.setAttribute("height", g.height);
  svg.innerHTML = g.markup;
  svg.parentElement.style.width = `${pad}px`;
  $("rows").innerHTML = commits.length
    ? commits.map((c, i) => rowHtml(c, pad, i)).join("")
    : '<p class="empty">コミットがまだありません</p>';
  $("count").textContent = `${commits.filter((c) => c.kind === "commit").length} 件`;
}

async function loadGraph(my) {
  const d = await api(`/api/graph?${q({ repo: current, limit: 400 })}`);
  if (my !== seq) return null;
  data = d;
  draw(d);
  return d;
}

export async function refresh() {
  if (!current) return;
  const my = ++seq;
  try {
    const d = await loadGraph(my);
    if (!d) return;
    if (!d.remotes.length) return showStatus("done", "フェッチ先なし(remote がありません)");
    showStatus("busy", "取得中…");
    const res = await api(`/api/fetch?${q({ repo: current })}`, { method: "POST" });
    if (my !== seq) return;
    if (!res.ok) return showStatus("err", `取得できず: ${res.error}`);
    fetchState = { state: "idle" };
    forget(`w:${current}`);
    await loadGraph(my);
    showFetched();
  } catch (e) {
    if (my === seq) showStatus("err", `読めませんでした: ${e.message}`);
  }
}

// 別のリポに切り替えたときだけ描き直す(同じリポで # が変わっただけなら何もしない)
export function open(repo) {
  if (repo === current) return;
  current = repo;
  data = null;
  window.scrollTo(0, 0);
  $("rows").innerHTML = "";
  $("lanes").innerHTML = "";
  showStatus("busy", "読み込み中…");
  refresh();
}

export const github = () => data?.github ?? null;
export const rowAt = (i) => data?.commits[i];
export const findCommit = (h) => data?.commits.find((c) => c.h === h);
