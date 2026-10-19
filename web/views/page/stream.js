// 差分を、変わったファイルぜんぶ縦につないで流し読みする(GitHub の Files changed と同じ形)。
// ファイルの一覧から選んだときは、そのファイルの頭までスクロールしておく。
// 何百ファイルのコミットもあるので、差分は画面に近づいたものから取る。上のファイルが後から読み込まれて
// 伸びると読んでいる場所がずれるので、画面に見えている読み込み済みのファイルが同じ位置に留まるよう
// scrollTop を足して戻す(iOS の Safari は自動で直さないため)。
import { esc } from "../../graph/rows.js";
import { getDiff, getFile } from "../../lib/api.js";
import { fileRow } from "../sheet.js";
import { diffHtml } from "./diffbody.js";
import { foldUnchanged, isMarkdown, mdDiffHtml } from "./md.js";

const LINE = 20; // .page-body の line-height。読み込む前の高さの見積もりに使う
const name = (p) => p.split("/").pop();
const textOf = async (repo, side) => (side ? (await getFile(repo, side.ref, side.path)).text ?? "" : "");

async function bodyHtml(r, s, f, md) {
  const args = s.diff(f);
  if (!args) return '<p class="note">差分にできるコミットが見つからない</p>';
  const { note, ...a } = args;
  const head = note ? `<p class="note">${esc(note)}</p>` : "";
  const p = md && isMarkdown(f.path) && s.pair(f);
  if (p) {
    const [x, y] = await Promise.all([textOf(r.repo, p.old), textOf(r.repo, p.new)]);
    return head + await mdDiffHtml(x, y, { repo: r.repo, ...(p.new ?? p.old) });
  }
  return head + diffHtml(await getDiff(r.repo, a));
}

export function stream(el, r, ctx, s, start, md) {
  const body = el.querySelector(".page-body");
  const files = s.files;
  body.innerHTML = files.map((f, i) => `<section class="df" data-i="${i}">${fileRow(f, `data-open="${i}"`)}`
    + `<div class="df-body" style="min-height:${Math.min(((f.add ?? 0) + (f.del ?? 0)) * LINE + 2 * LINE, 4000)}px">`
    + '<p class="note">読み込み中…</p></div></section>').join("");
  const secs = [...body.querySelectorAll(".df")];
  const loaded = new Map(); // i → 読み込みの Promise(同じファイルを 2 度取らない)
  const done = new Set();
  // 位置を保つ目印: 画面に見えている読み込み済みのファイル(無ければ上端にかかっているファイル)
  const anchor = () => {
    const y = body.scrollTop, end = y + body.clientHeight;
    let at = 0;
    for (let i = 0; i < secs.length && secs[i].offsetTop < end; i++) {
      if (secs[i].offsetTop + secs[i].offsetHeight <= y) continue;
      if (done.has(i)) return i;
      if (secs[i].offsetTop <= y) at = i;
    }
    return at;
  };

  const fill = (i) => {
    if (loaded.has(i)) return loaded.get(i);
    const sec = secs[i], box = sec.querySelector(".df-body");
    const p = bodyHtml(r, s, files[i], md).catch((e) => `<p class="note err">${esc(e.message)}</p>`).then((html) => {
      const a = anchor(), keep = secs[a].offsetTop - body.scrollTop;
      box.innerHTML = html;
      box.style.minHeight = "";
      for (const m of box.querySelectorAll(".markdown")) foldUnchanged(m);
      done.add(i);
      if (i < a) body.scrollTop = secs[a].offsetTop - keep;
    });
    loaded.set(i, p);
    return p;
  };

  // いま読んでいるファイル: 頭が画面の上端を過ぎた最後のもの。位置の表示と前後のボタン、# を合わせる
  let cur = -1, timer = 0;
  const nav = el.querySelector(".page-nav");
  const setCur = (i) => {
    if (i === cur) return;
    cur = i;
    el.querySelector(".pos").textContent = files.length > 1 ? `${i + 1} / ${files.length}` : "";
    const prev = files[i - 1], next = files[i + 1];
    nav.querySelector(".prev").textContent = prev ? `‹ ${name(prev.path)}` : "";
    nav.querySelector(".next").textContent = next ? `${name(next.path)} ›` : "";
    // 「戻る」やホーム画面からの開き直しで同じファイルに戻れるよう、# だけ静かに差し替える(Safari は回数に上限があるので間引く)
    clearTimeout(timer);
    timer = setTimeout(() => ctx.mark(s.route(files[i])), 400);
  };
  const onScroll = () => {
    const y = body.scrollTop + 1;
    let i = 0;
    while (i + 1 < secs.length && secs[i + 1].offsetTop <= y) i++;
    setCur(i);
  };
  const jump = async (i) => {
    await fill(i);
    body.scrollTop = secs[i].offsetTop;
    onScroll();
  };

  nav.hidden = files.length < 2;
  nav.querySelector(".hint").hidden = true;
  nav.querySelector(".prev").onclick = () => cur > 0 && jump(cur - 1);
  nav.querySelector(".next").onclick = () => cur + 1 < files.length && jump(cur + 1);
  body.addEventListener("click", (e) => {
    const b = e.target.closest("[data-open]");
    if (b) ctx.go({ ...s.route(files[+b.dataset.open]), v: "file" }, { replace: true });
  });
  body.addEventListener("scroll", onScroll, { passive: true });
  setCur(start);
  jump(start).then(() => {
    const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) fill(+e.target.dataset.i); },
      { root: body, rootMargin: "800px 0px" });
    for (const sec of secs) io.observe(sec);
  });
  return { current: () => files[Math.max(cur, 0)] };
}
