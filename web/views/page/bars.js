// 差分の画面の帯まわり: 整形した差分の「次の変更へ」、ファイル表示の行番号の帯、前後のファイルへの横スワイプ。
import { esc } from "../../graph/rows.js";

// 整形した差分は文書を頭から全部出すので、変わった塊へ送る帯を出し、最初の変更まで送っておく
export function changeNav(el) {
  const marks = [...el.querySelectorAll(".rd-add, .rd-del, .rd-mod")];
  const bar = el.querySelector(".linebar");
  if (!marks.length) { bar.hidden = true; return; }
  let k = 0;
  const go = (n) => {
    k = (n + marks.length) % marks.length;
    marks[k].scrollIntoView({ block: "center" });
    bar.querySelector("span").textContent = `変更 ${k + 1} / ${marks.length}`;
  };
  bar.innerHTML = '<span></span><div><button type="button" data-d="-1">↑ 前</button> <button type="button" data-d="1">次 ↓</button></div>';
  bar.onclick = (e) => { const b = e.target.closest("button[data-d]"); if (b) go(k + +b.dataset.d); };
  bar.hidden = false;
  go(0);
}

// 行番号をタップすると、その行を GitHub で開く・リンクをコピーするための帯を出す
export function lines(el, r, ctx, sha) {
  const bar = el.querySelector(".linebar");
  const pick = (n, scroll) => {
    for (const x of el.querySelectorAll(".fl.sel")) x.classList.remove("sel");
    const row = el.querySelector(`#L${n}`);
    if (!row) return;
    row.classList.add("sel");
    if (scroll) row.scrollIntoView({ block: "center" });
    const gh = ctx.github() && sha ? `${ctx.github()}/blob/${sha}/${r.path.split("/").map(encodeURIComponent).join("/")}#L${n}` : null;
    bar.innerHTML = (gh ? `<a href="${esc(gh)}" target="_blank" rel="noopener">${n} 行目を GitHub で開く</a>` : `<span>${n} 行目</span>`)
      + '<button type="button">リンクをコピー</button>';
    bar.querySelector("button").onclick = () => navigator.clipboard?.writeText(gh ?? `${r.path}:${n}`);
    bar.hidden = false;
  };
  el.querySelector(".page-body").addEventListener("click", (e) => {
    const b = e.target.closest(".ln[data-n]");
    if (b) pick(b.dataset.n, false);
  });
  if (r.line) pick(r.line, true);
}

export function swipe(target, onLeft, onRight) {
  let x0 = null, y0 = null;
  target.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  target.addEventListener("touchend", (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
    x0 = null;
    // 横長のコードを横に送っているときと見分けるため、縦の動きが小さく十分長いときだけ
    if (Math.abs(dx) > 80 && Math.abs(dy) < 40 && target.scrollLeft === 0) (dx < 0 ? onLeft : onRight)();
  }, { passive: true });
}
