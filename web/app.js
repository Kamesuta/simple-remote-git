// 起動と # の振り分け。グラフ(のちに変更のタブも)の上に、詳細のシートと差分の画面を重ねる。
// アプリの中の移動は pushState で積み、「戻る」はそれを 1 つ戻す。積んだものが無い
// (ホーム画面から開き直した・貼ったリンクから来た)ときは、親の画面へ置き換える。
import * as graph from "./graph/view.js";
import { esc, label } from "./graph/rows.js";
import { api } from "./lib/api.js";
import { build, parent, parse, tabOf } from "./lib/route.js";
import { setupTheme } from "./lib/theme.js";
import * as changes from "./views/changes.js";
import { diffPage } from "./views/diff.js";
import { searchPage } from "./views/search.js";
import { sheet } from "./views/sheet.js";

const $ = (id) => document.getElementById(id);
let repos = [];
let depth = 0; // アプリの中で積んだ履歴の数
let layerKey = null; // いま重ねている画面の #(同じなら作り直さない)

const store = {
  get: () => { try { return localStorage.getItem("repo"); } catch { return null; } },
  set: (v) => { try { localStorage.setItem("repo", v); } catch { /* 覚えられなくても動く */ } },
};

function route() {
  const r = parse(location.hash);
  if (!r.repo) r.repo = repos.some((x) => x.name === store.get()) ? store.get() : repos[0]?.name;
  return r;
}

export function go(r, { replace = false } = {}) {
  if (replace) history.replaceState({ d: depth }, "", build(r));
  else history.pushState({ d: ++depth }, "", build(r));
  show();
}

function back() {
  if (depth > 0) history.back();
  else go(parent(route()), { replace: true });
}

const ctx = { go, back, github: graph.github, findCommit: graph.findCommit };

function header(repo) {
  const r = repos.find((x) => x.name === repo) ?? { name: repo };
  $("repo-label").textContent = label(r);
  $("repo-path").textContent = `~/softdata/git/${repo}`;
  document.title = `${label(r)} — Git Graph`;
  for (const b of $("repos").children) {
    b.setAttribute("aria-pressed", String(b.dataset.name === repo));
    if (b.dataset.name === repo) b.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
}

function show() {
  const r = route();
  if (!r.repo) return;
  store.set(r.repo);
  header(r.repo);
  graph.open(r.repo);
  const tab = tabOf(r);
  $("graph").hidden = tab !== "graph";
  $("changes").hidden = tab !== "changes";
  for (const b of document.querySelectorAll(".tabs button")) b.setAttribute("aria-pressed", String(b.dataset.tab === tab));
  if (r.view === "changes" || (tab === "changes" && $("changes").childElementCount === 0)) changes.show(r, ctx);
  const key = ["commit", "stash", "diff", "search"].includes(r.view) ? build(r) : null;
  if (key === layerKey) return;
  layerKey = key;
  const layer = $("layer");
  layer.replaceChildren();
  if (r.view === "commit" || r.view === "stash") layer.append(sheet(r, ctx));
  else if (r.view === "diff") layer.append(diffPage(r, ctx));
  else if (r.view === "search") layer.append(searchPage(r, ctx));
  // 重ねた画面だけをスクロールさせ、下のグラフは位置を保ったまま止めておく
  document.body.classList.toggle("locked", !!key);
}

$("rows").addEventListener("click", (e) => {
  const b = e.target.closest(".row[data-i]");
  const c = b && graph.rowAt(+b.dataset.i);
  if (!c) return;
  const repo = route().repo;
  if (c.kind === "commit") go({ repo, view: "commit", h: c.h });
  else if (c.kind === "stash") go({ repo, view: "stash", name: c.h });
  else go({ repo, view: "changes", wt: c.wt });
});
document.querySelector(".tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (b) go({ repo: route().repo, view: b.dataset.tab }, { replace: true });
});
graph.onLoad(() => {
  const n = graph.wipTotal();
  $("wip-n").hidden = !n;
  $("wip-n").textContent = n;
});
$("repos").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (b && b.dataset.name !== route().repo) go({ repo: b.dataset.name, view: "graph" });
});
window.addEventListener("popstate", (e) => { depth = e.state?.d ?? 0; show(); });
$("search").addEventListener("click", () => go({ repo: route().repo, view: "search" }));
$("refresh").addEventListener("click", graph.refresh);
$("retry").addEventListener("click", graph.refresh);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  graph.refresh();
  if (route().view === "changes") changes.show(route(), ctx); // 戻ってきたら未コミットも取り直す
});
setInterval(graph.showFetched, 30000); // 「n 分前」を進める
setupTheme();

async function start() {
  try {
    repos = await api("/api/repos");
  } catch (e) {
    $("status").dataset.state = "err";
    $("status-text").textContent = `一覧を読めませんでした: ${e.message}`;
    return;
  }
  $("repos").innerHTML = repos.map((r) =>
    `<button type="button" data-name="${esc(r.name)}" aria-pressed="false">${esc(label(r))}</button>`).join("");
  if (!repos.length && !location.hash) {
    $("status-text").textContent = "~/softdata/git に git リポが見つかりません";
    return;
  }
  history.replaceState({ d: 0 }, "", build(route()));
  show();
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
start();
