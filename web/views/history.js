// そのファイルを変えたコミットの一覧(新しい順に 200 件まで)。タップでそのコミットでのそのファイルの差分へ。
// 名前を変える前のコミットはたどらない(git log --follow で前の名前まで行くと、差分の取り方が変わるため)。
import { ago, esc } from "../graph/rows.js";
import { getLog } from "../lib/api.js";

export function historyPage(r, ctx) {
  const el = document.createElement("section");
  el.className = "page";
  const name = r.path.split("/").pop();
  el.innerHTML = `
    <header class="page-top">
      <button type="button" class="back" aria-label="戻る">‹</button>
      <div class="names"><h2>${esc(name)} の履歴</h2><p class="sub">${esc(r.path)}</p></div>
    </header>
    <div class="hist-body"><p class="note">読み込み中…</p></div>`;
  el.querySelector(".back").onclick = () => ctx.back();
  const body = el.querySelector(".hist-body");
  getLog(r.repo, { ref: r.ref, path: r.path, n: 200 }).then((list) => {
    body.innerHTML = list.length
      ? list.map((c) => `<button type="button" class="hrow" data-h="${c.h}"><span class="hs">${esc(c.s)}</span>`
        + `<span class="hm">${esc(c.an)} · ${ago(c.at)}<code>${c.h.slice(0, 7)}</code></span></button>`).join("")
        + (list.length >= 200 ? '<p class="note">新しい 200 件だけ出している</p>' : "")
      : '<p class="note">このファイルを変えたコミットが無い(まだコミットしていない新しいファイル)</p>';
  }).catch((e) => { body.innerHTML = `<p class="note err">${esc(e.message)}</p>`; });
  body.addEventListener("click", (e) => {
    const b = e.target.closest(".hrow[data-h]");
    if (b) ctx.go({ repo: r.repo, view: "diff", src: "commit", h: b.dataset.h, path: r.path });
  });
  return el;
}
