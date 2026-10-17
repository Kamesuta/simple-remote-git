// コミット・スタッシュの詳細。グラフの上に下から上がるシートとして重ね、ファイルを選ぶと差分を開く。
// 「GitHub で開く」はここに置く。未プッシュのうちは GitHub に無いので、押せない形にして理由を書く。
import { ago, chips, esc } from "../graph/rows.js";
import { getCommit, getStash } from "../lib/api.js";

const BADGE = { A: "add", M: "mod", D: "del", R: "ren", C: "ren", T: "mod", U: "add", "!": "del" };

// ファイルの行。変更のタブでも同じ形を使う(名前・フォルダ・状態の印・+/-)
export function fileRow(f, attrs, { dir = true } = {}) {
  const name = f.path.split("/").pop();
  const folder = f.old ? `${f.old} → ${f.path.slice(0, -name.length) || "./"}` : f.path.slice(0, -name.length) || "./";
  const nums = f.binary ? '<i class="muted">バイナリ</i>'
    : f.status === "R" && !f.add && !f.del ? '<i class="muted">名前だけ</i>'
      : `${f.add ? `<i class="n-add">+${f.add}</i>` : ""}${f.del ? ` <i class="n-del">−${f.del}</i>` : ""}`;
  return `<button type="button" class="frow" ${attrs}><span class="badge ${BADGE[f.status] ?? "mod"}">${esc(f.status)}</span>`
    + `<span class="fname"><b>${esc(name)}</b>${dir ? `<small>${esc(folder)}${f.untracked ? " · 新規" : ""}</small>` : ""}</span>`
    + `<span class="nums">${nums}</span></button>`;
}

export function sheet(r, ctx) {
  const wrap = document.createElement("div");
  wrap.className = "sheet-wrap";
  wrap.innerHTML = '<div class="backdrop"></div><section class="sheet"><div class="grab"></div><div class="sheet-body"><p class="note">読み込み中…</p></div></section>';
  wrap.querySelector(".backdrop").onclick = () => ctx.back();
  const body = wrap.querySelector(".sheet-body");
  const load = r.view === "commit" ? getCommit(r.repo, r.h) : getStash(r.repo, r.name);
  load.then((d) => {
    body.innerHTML = r.view === "commit" ? commitHtml(d, ctx) : stashHtml(d);
    body.querySelector(".sha-btn")?.addEventListener("click", () => navigator.clipboard?.writeText(d.h));
    body.addEventListener("click", (e) => {
      const b = e.target.closest("[data-i], [data-parent]");
      if (!b) return;
      if (b.dataset.parent) return ctx.go({ repo: r.repo, view: "commit", h: b.dataset.parent });
      const f = d.files[+b.dataset.i];
      ctx.go(r.view === "commit"
        ? { repo: r.repo, view: "diff", src: "commit", h: d.h, path: f.path, old: f.old }
        : { repo: r.repo, view: "diff", src: "stash", name: r.name, path: f.path, old: f.old });
    });
  }).catch((e) => { body.innerHTML = `<p class="note err">${esc(e.message)}</p>`; });
  return wrap;
}

function filesHtml(files) {
  const add = files.reduce((n, f) => n + (f.add ?? 0), 0), del = files.reduce((n, f) => n + (f.del ?? 0), 0);
  return `<div class="files-head"><b>変わったファイル ${files.length}</b><span><i class="n-add">+${add}</i> <i class="n-del">−${del}</i></span></div>`
    + files.map((f, i) => fileRow(f, `data-i="${i}"`)).join("");
}

function commitHtml(d, ctx) {
  const refs = ctx.findCommit(d.h)?.refs ?? d.refs; // グラフに載っていれば、ワークツリーの印の付いた方を使う
  const gh = d.github && d.pushed ? `${d.github}/commit/${d.h}` : null;
  const why = !d.github ? "origin が GitHub でないので開く先が無い" : !d.pushed ? "まだプッシュしていないので GitHub に無い" : "";
  const parents = d.p.map((p, k) => `<button type="button" class="btn" data-parent="${p}">${d.p.length > 1 ? `親 ${k + 1}` : "親"} ${p.slice(0, 7)} へ</button>`).join("");
  return `<h2 class="subject">${esc(d.s)}</h2>${d.body ? `<p class="body">${esc(d.body)}</p>` : ""}
    <div class="meta-row"><span>${esc(d.an)} · ${ago(d.at)}</span><button type="button" class="sha-btn" aria-label="SHA をコピー">${d.h.slice(0, 7)} · コピー</button></div>
    <div class="chips-row">${chips(refs)}${d.pushed ? "" : '<span class="chip unpushed-chip">未プッシュ</span>'}</div>
    <div class="btns">${gh ? `<a class="btn" href="${esc(gh)}" target="_blank" rel="noopener">GitHub で開く</a>` : '<span class="btn off">GitHub で開く</span>'}${parents}</div>
    ${why ? `<p class="why">${why}</p>` : ""}${filesHtml(d.files)}`;
}

function stashHtml(d) {
  return `<h2 class="subject">${esc(d.s)}</h2>
    <div class="meta-row"><span>${esc(d.name)} · ${ago(d.at)}</span></div>
    <div class="btns"><button type="button" class="btn" data-parent="${d.p[0]}">元のコミット ${d.p[0].slice(0, 7)} へ</button></div>
    ${filesHtml(d.files)}`;
}
