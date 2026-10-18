// ファイルのタブ。ある版のファイルを差分の有無にかかわらず全部、フォルダの木で並べる(VS Code のエクスプローラーと同じ)。
// 作業中の版では、変えたファイルに M / U / D の印と色、変更を抱えたフォルダに点を付ける。
// 上の欄に名前の一部を打つと、木をやめて当たったファイルを平らに並べる。
import { esc } from "../graph/rows.js";
import { api, q } from "../lib/api.js";
import { buildTree, flatten } from "../lib/tree.js";

const MAIN = "wt:作業ツリー";
const MARK = { M: "mod", A: "add", U: "add", D: "del", R: "ren", "!": "del" };
const opened = new Map(); // repo + 版 → 開いたフォルダ。タブを行き来しても覚えておく
let cur = { key: null, data: null, tree: null, refs: null, filter: "" };

const dirtyDirs = (marks) => {
  const out = new Set();
  for (const p of Object.keys(marks)) p.split("/").slice(0, -1).reduce((acc, d) => { const x = acc ? `${acc}/${d}` : d; out.add(x); return x; }, "");
  return out;
};

function label(ref, refs) {
  if (ref.startsWith("wt:")) {
    const w = refs?.worktrees.find((x) => x.name === ref.slice(3));
    return `作業中 · ${w?.branch ?? ref.slice(3)}`;
  }
  const named = refs && [...refs.branches, ...refs.tags].find((x) => x.sha === ref);
  return named ? named.name : ref.slice(0, 7);
}

// 木に並べるもの: 追跡中と新しいファイル、gitignore されたもの(薄く出す)、丸ごと無視されたフォルダ。
// 無視されたフォルダは、開いて中を読んだもの(cur.extra)だけ中身を足す
function items() {
  const { data, extra } = cur;
  const out = data.files.map((path) => ({ path }));
  for (const path of data.ignored ?? []) out.push({ path, ignored: true });
  const dirs = [...(data.ignoredDirs ?? [])];
  for (const e of extra.values()) {
    for (const path of e.files) out.push({ path, ignored: true });
    dirs.push(...e.dirs);
  }
  for (const path of dirs) out.push({ path, dir: true, ignored: true, lazy: !extra.has(path) });
  return out;
}

function fileLine(f, depth, marks, showDir) {
  const path = f.path, name = path.split("/").pop(), m = marks[path];
  const dir = showDir ? `<small>${esc(path.slice(0, -name.length) || "./")}</small>` : "";
  return `<button type="button" class="xrow file${m ? ` m-${MARK[m] ?? "mod"}` : ""}${f.ignored ? " ign" : ""}" style="padding-left:${showDir ? 16 : 32 + depth * 16}px" data-path="${esc(path)}">`
    + `<span class="xname">${esc(name)}${dir}</span>${m ? `<b class="xmark">${esc(m)}</b>` : ""}</button>`;
}

function listHtml(open) {
  const { data, tree, filter } = cur;
  if (filter.trim()) {
    const terms = filter.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = items().filter((f) => !f.dir && terms.every((t) => f.path.toLowerCase().includes(t)));
    // 名前(パスの最後)に当たったものを上に、短いパスを上に
    const base = (f) => f.path.split("/").pop().toLowerCase();
    hits.sort((a, b) => (terms.every((t) => base(b).includes(t)) - terms.every((t) => base(a).includes(t))) || a.path.length - b.path.length);
    return hits.length ? hits.slice(0, 200).map((f) => fileLine(f, 0, data.marks, true)).join("")
      + (hits.length > 200 ? `<p class="note">ほか ${hits.length - 200} 件。もう少し絞る</p>` : "")
      : '<p class="note">当たるファイルが無い</p>';
  }
  const dirty = dirtyDirs(data.marks);
  return flatten(tree, (p) => !open.has(p)).map((r) => (r.type === "dir"
    ? `<button type="button" class="xrow dir${r.ignored ? " ign" : ""}" style="padding-left:${12 + r.depth * 16}px" data-dir="${esc(r.path)}"${r.lazy ? ' data-lazy="1"' : ""} aria-expanded="${r.open && !r.lazy}">`
      + `<span class="caret">${r.open && !r.lazy ? "▾" : "▸"}</span><b>${esc(r.name)}</b>${dirty.has(r.path) ? '<i class="xdot"></i>' : ""}</button>`
    : fileLine(r.f, r.depth, data.marks, false))).join("");
}

function pickerHtml(ref, refs) {
  const item = (v, text, sub) => `<button type="button" class="pick${v === ref ? " on" : ""}" data-ref="${esc(v)}">${esc(text)}${sub ? `<small>${esc(sub)}</small>` : ""}</button>`;
  return `<h4 class="part">作業中(ワークツリー)</h4>${refs.worktrees.map((w) => item(`wt:${w.name}`, w.branch ?? w.name, w.main ? "本体" : w.name)).join("")}`
    + `<h4 class="part">ブランチ</h4>${refs.branches.map((b) => item(b.sha, b.name, b.sha.slice(0, 7))).join("")}`
    + (refs.tags.length ? `<h4 class="part">タグ</h4>${refs.tags.map((t) => item(t.sha, t.name, t.sha.slice(0, 7))).join("")}` : "");
}

// 同じ版のまま戻ってきたら作り直さない(絞り込みの文字とスクロールの位置を残すため)。中身だけ取り直す
export function show(r, ctx) {
  const el = document.getElementById("files");
  const ref = r.ref || MAIN;
  const key = `${r.repo}\0${ref}`;
  if (!opened.has(key)) opened.set(key, new Set());
  const open = opened.get(key);
  if (cur.key !== key || el.dataset.key !== key) build(el, r, ctx, ref, key, open);
  const list = el.querySelector(".xlist");
  Promise.all([api(`/api/tree?${q({ repo: r.repo, ref })}`), cur.refs ?? api(`/api/refs?${q({ repo: r.repo })}`)])
    .then(([data, refs]) => {
      if (cur.key !== key) return;
      Object.assign(cur, { data, refs });
      cur.tree = buildTree(items());
      el.querySelector(".ver").textContent = `${label(ref, refs)} ▾`;
      list.innerHTML = listHtml(open);
    }).catch((e) => { list.innerHTML = `<p class="note err">${esc(e.message)}</p>`; });
}

function build(el, r, ctx, ref, key, open) {
  const sameRepo = cur.key?.startsWith(`${r.repo}\0`);
  cur = { key, data: null, tree: null, refs: sameRepo ? cur.refs : null, filter: "", extra: new Map() };
  el.dataset.key = key;
  el.innerHTML = `<div class="files-top"><h3>ファイル</h3><button type="button" class="ver">${esc(label(ref, cur.refs))} ▾</button></div>
    <div class="picker" hidden></div>
    <input type="search" class="xfilter" placeholder="名前で絞り込む(例: rows)" autocomplete="off" autocapitalize="off" spellcheck="false">
    <div class="xlist"><p class="note">読み込み中…</p></div>`;
  const list = el.querySelector(".xlist"), picker = el.querySelector(".picker");
  const draw = () => { if (cur.data) list.innerHTML = listHtml(open); };
  // 丸ごと無視されたフォルダは、開いたときに中(1 段)を読んで木に足す
  const loadDir = (path) => {
    const caret = list.querySelector(`[data-dir="${CSS.escape(path)}"] .caret`);
    if (caret) caret.textContent = "…"; // 読んでいるあいだの印
    api(`/api/dir?${q({ repo: r.repo, ref, path })}`).then((res) => {
      if (cur.key !== key) return;
      cur.extra.set(path, res);
      open.add(path);
      cur.tree = buildTree(items());
      draw();
    }).catch((e) => { list.insertAdjacentHTML("afterbegin", `<p class="note err">${esc(e.message)}</p>`); });
  };
  el.querySelector(".xfilter").addEventListener("input", (e) => { cur.filter = e.target.value; draw(); });
  el.querySelector(".ver").onclick = () => {
    if (!cur.refs) return;
    picker.innerHTML = pickerHtml(ref, cur.refs);
    picker.hidden = !picker.hidden;
  };
  picker.onclick = (e) => {
    const b = e.target.closest(".pick[data-ref]");
    if (b) ctx.go({ repo: r.repo, view: "files", ref: b.dataset.ref === MAIN ? undefined : b.dataset.ref }, { replace: true });
  };
  list.onclick = (e) => {
    const d = e.target.closest("[data-dir]");
    if (d && d.dataset.lazy) return loadDir(d.dataset.dir);
    if (d) { if (open.has(d.dataset.dir)) open.delete(d.dataset.dir); else open.add(d.dataset.dir); return draw(); }
    const f = e.target.closest("[data-path]");
    if (!f) return;
    // 消したファイルは中身が無いので、差分で開く
    const gone = cur.data.marks[f.dataset.path] === "D";
    ctx.go({ repo: r.repo, view: "diff", src: "open", ref, path: f.dataset.path, v: gone ? undefined : "file" });
  };
}
