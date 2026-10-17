// 変更のタブ。ワークツリーごとに、ステージ済み・未ステージ・新しいファイルを分け、それぞれをフォルダの木で並べる。
// ファイルをタップすると差分を開く(ファイル全体へは、開いた先の「差分 / ファイル」で切り替える)。
import { esc } from "../graph/rows.js";
import { forget, getChanges } from "../lib/api.js";
import { PARTS } from "../lib/route.js";
import { buildTree, flatten } from "../lib/tree.js";
import { fileRow } from "./sheet.js";

const TITLE = { staged: "ステージ済み", unstaged: "未ステージ", untracked: "新しいファイル" };
const closed = new Set(); // 閉じたフォルダ(ワークツリー名 + 段 + パス)。描き直しても覚えておく
let last = { repo: null, wts: [] };

const count = (w) => PARTS.reduce((n, p) => n + w[p].length, 0);
const sum = (w, k) => PARTS.reduce((n, p) => n + w[p].reduce((m, f) => m + (f[k] ?? 0), 0), 0);

function partHtml(w, part) {
  const files = w[part];
  if (!files.length) return "";
  const key = (path) => `${w.name}\0${part}\0${path}`;
  const shut = new Set([...closed].filter((k) => k.startsWith(`${w.name}\0${part}\0`)).map((k) => k.split("\0")[2]));
  const rows = flatten(buildTree(files), shut).map((r) => {
    const pad = `style="padding-left:${r.depth * 18}px"`;
    if (r.type === "dir") {
      return `<button type="button" class="drow" ${pad} data-key="${esc(key(r.path))}" aria-expanded="${r.open}">`
        + `<span class="caret">${r.open ? "▾" : "▸"}</span><b>${esc(r.name)}</b></button>`;
    }
    const i = files.indexOf(r.f);
    return `<div class="tnode" ${pad}>${fileRow(r.f, `data-wt="${esc(w.name)}" data-part="${part}" data-i="${i}"`, { dir: false })}</div>`;
  });
  return `<h4 class="part">${TITLE[part]} · ${files.length}</h4>${rows.join("")}`;
}

function cardHtml(w, focus) {
  const n = count(w);
  const title = esc(w.branch ?? w.name);
  if (!n) return `<div class="wt-quiet"><b>${title}${w.main ? "(本体)" : ""}</b><span>${esc(w.path)}</span></div>`;
  return `<section class="wt-card${focus ? " focus" : ""}" data-wt="${esc(w.name)}">
    <div class="wt-head"><b>${title}</b><span><i class="n-add">+${sum(w, "add")}</i> <i class="n-del">−${sum(w, "del")}</i></span></div>
    <p class="wt-path">${esc(w.path)}${w.error ? ` · 読めず: ${esc(w.error)}` : ""}</p>
    ${PARTS.map((p) => partHtml(w, p)).join("")}</section>`;
}

function draw(el, wts, focusWt) {
  // 変更のあるワークツリーをカードで並べ、変更の無いものはまとめて畳む(my-app は 19 個あり、並べるとうるさい)
  const busy = wts.filter(count), quiet = wts.filter((w) => !count(w));
  const open = el.querySelector(".quiet-list")?.open ? " open" : "";
  el.innerHTML = `<div class="changes-head"><h3>変更</h3><span>${wts.length} つのワークツリー</span></div>`
    + (busy.length ? busy.map((w) => cardHtml(w, w.name === focusWt)).join("") : '<p class="note">未コミットの変更はありません</p>')
    + (quiet.length ? `<details class="quiet-list"${open}><summary>変更のないワークツリー ${quiet.length}</summary>${quiet.map((w) => cardHtml(w)).join("")}</details>` : "");
}

export function show(r, ctx) {
  const el = document.getElementById("changes");
  if (last.repo !== r.repo) { el.innerHTML = '<p class="note">読み込み中…</p>'; last = { repo: r.repo, wts: [] }; }
  else draw(el, last.wts, r.wt); // 前の分をすぐ出し、取り直したら描き直す
  forget(`w:${r.repo}`);
  getChanges(r.repo).then((wts) => {
    if (last.repo !== r.repo) return;
    last.wts = wts;
    draw(el, wts, r.wt);
    if (r.wt) el.querySelector(".wt-card.focus")?.scrollIntoView({ block: "start" });
  }).catch((e) => { el.innerHTML = `<p class="note err">${esc(e.message)}</p>`; });
  el.onclick = (e) => {
    const d = e.target.closest(".drow");
    if (d) {
      if (closed.has(d.dataset.key)) closed.delete(d.dataset.key); else closed.add(d.dataset.key);
      return draw(el, last.wts, r.wt);
    }
    const b = e.target.closest(".frow[data-part]");
    if (!b) return;
    const w = last.wts.find((x) => x.name === b.dataset.wt);
    const f = w[b.dataset.part][+b.dataset.i];
    ctx.go({ repo: r.repo, view: "diff", src: b.dataset.part, wt: w.name, path: f.path, old: f.old });
  };
}

// 下のタブに出す数(全ワークツリーの未コミットのファイル数)
export const total = () => last.wts.reduce((n, w) => n + count(w), 0);
