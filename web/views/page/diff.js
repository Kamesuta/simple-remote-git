// 差分の画面。上の「差分 / ファイル」で、同じ版のファイル全体と行き来する(開く前には選ばせない)。
// 差分は変わったファイルぜんぶを縦につないで流し読みする(stream.js)。ファイルは 1 つずつで、
// 前後へは下のボタンか横スワイプ。切り替えと前後は履歴を積まない(「戻る」で一覧に戻れるように)。
import { esc } from "../../graph/rows.js";
import { fileUrl, getFile } from "../../lib/api.js";
import { fileHtml } from "./diffbody.js";
import { isMarkdown, mdHtml } from "./md.js";
import { lines, swipe } from "./bars.js";
import { sources } from "./sources.js";
import { stream } from "./stream.js";

const IMAGE = /\.(png|jpe?g|gif|webp|svg|ico)$/i;
const flag = (k) => { try { return localStorage.getItem(k) !== "off"; } catch { return true; } };
const wrapOn = () => flag("wrap");
const mdOn = () => flag("md"); // Markdown を整形して見せるか(既定は整形。GitHub の Rich Diff と同じ見え方)
const split = (p) => { const name = p.split("/").pop(); return [name, p.slice(0, -name.length) || "./"]; };

export function diffPage(r, ctx) {
  const el = document.createElement("section");
  el.className = "page";
  const [name, dir] = split(r.path);
  const mode = r.v === "file" ? "file" : "diff";
  el.innerHTML = `
    <header class="page-top">
      <button type="button" class="back" aria-label="戻る">‹</button>
      <div class="names"><h2>${esc(name)}</h2><p class="sub">${esc(dir)}</p></div>
      <span class="pos"></span>
      <button type="button" class="hist-btn" hidden>履歴</button>
    </header>
    <div class="tools">
      <div class="seg view-seg"><button type="button" data-v="diff" aria-pressed="${mode === "diff"}">差分</button><button type="button" data-v="file" aria-pressed="${mode === "file"}">ファイル</button></div>
      <div class="seg md-seg"${isMarkdown(r.path) ? "" : " hidden"}><button type="button" data-md="on">整形</button><button type="button" data-md="off">テキスト</button></div>
      <button type="button" class="wrap" aria-pressed="${wrapOn()}">折り返し</button>
      <span class="counts"></span>
    </div>
    <div class="page-body${wrapOn() ? " wrapped" : ""}"><p class="note">読み込み中…</p></div>
    <footer class="page-nav" hidden><button type="button" class="prev"></button><span class="hint">左右に送っても移れる</span><button type="button" class="next"></button></footer>
    <div class="linebar" hidden></div>`;
  const $ = (s) => el.querySelector(s);
  $(".back").onclick = () => ctx.back();
  $(".wrap").onclick = () => {
    const on = !wrapOn();
    try { localStorage.setItem("wrap", on ? "on" : "off"); } catch { /* 今だけ切り替わる */ }
    $(".wrap").setAttribute("aria-pressed", String(on));
    $(".page-body").classList.toggle("wrapped", on);
  };
  load(el, r, ctx, mode).catch((e) => { $(".page-body").innerHTML = `<p class="note err">${esc(e.message)}</p>`; });
  return el;
}

async function load(el, r, ctx, mode) {
  const $ = (s) => el.querySelector(s);
  const s = await sources(r);
  const i = Math.max(0, s.files.findIndex((f) => f.path === r.path && (!f.part || f.part === r.src)));
  const f = s.files[i] ?? { path: r.path };
  if (mode === "diff") return loadStream(el, r, ctx, s, i);
  $(".sub").textContent = `${split(r.path)[1]} · ${s.title}`;
  $(".counts").innerHTML = f.add != null ? `<i class="n-add">+${f.add}</i> <i class="n-del">−${f.del ?? 0}</i>` : "";
  const hist = $(".hist-btn");
  hist.hidden = false;
  hist.onclick = () => ctx.go({ repo: r.repo, view: "history", ref: s.ref(f), path: r.path });
  const goFile = (g, v) => ctx.go({ ...s.route(g), v: v === "file" ? "file" : undefined }, { replace: true });
  for (const b of el.querySelectorAll(".view-seg button")) b.onclick = () => goFile(f, b.dataset.v);
  if (s.files.length > 1) {
    $(".pos").textContent = `${i + 1} / ${s.files.length}`;
    const prev = s.files[i - 1], next = s.files[i + 1];
    $(".page-nav").hidden = false;
    $(".prev").textContent = prev ? `‹ ${split(prev.path)[0]}` : "";
    $(".next").textContent = next ? `${split(next.path)[0]} ›` : "";
    if (prev) $(".prev").onclick = () => goFile(prev, r.v);
    if (next) $(".next").onclick = () => goFile(next, r.v);
    $(".hint").hidden = !!(prev && next); // 両側にファイル名が並ぶと案内の入る幅が無い
    swipe($(".page-body"), () => next && goFile(next, r.v), () => prev && goFile(prev, r.v));
  }
  // Markdown は「整形 / テキスト」で切り替える。整形しているあいだは折り返しが要らないので隠す
  const syncMd = () => {
    for (const b of el.querySelectorAll(".md-seg button")) b.setAttribute("aria-pressed", String((b.dataset.md === "on") === mdOn()));
    $(".wrap").hidden = isMarkdown(r.path) && mdOn();
  };
  for (const b of el.querySelectorAll(".md-seg button")) {
    b.onclick = () => {
      if ((b.dataset.md === "on") === mdOn()) return;
      try { localStorage.setItem("md", b.dataset.md); } catch { /* 今だけ切り替わる */ }
      syncMd();
      paint(el, r, ctx, s, f).catch((e) => { $(".page-body").innerHTML = `<p class="note err">${esc(e.message)}</p>`; });
    };
  }
  syncMd();
  await paint(el, r, ctx, s, f);
}

async function paint(el, r, ctx, s, f) {
  const body = el.querySelector(".page-body");
  const md = isMarkdown(r.path) && mdOn();
  const ref = s.ref(f);
  if (IMAGE.test(r.path)) { body.innerHTML = `<img class="img" alt="${esc(r.path)}" src="${fileUrl(r.repo, ref, r.path)}">`; return; }
  const d = await getFile(r.repo, ref, r.path);
  if (d.binary) { body.innerHTML = `<p class="note">バイナリのファイル(${d.size} バイト)</p>`; return; }
  if (md) { body.innerHTML = await mdHtml(d.text, { repo: r.repo, ref, path: r.path }); return; }
  body.innerHTML = fileHtml(d.text, d.truncated);
  lines(el, r, ctx, d.sha);
}

// 差分の流し読み。見出しは元(コミット・ワークツリー)にし、ファイルごとの名前は流れの中の見出しに出す
function loadStream(el, r, ctx, s, i) {
  const $ = (q) => el.querySelector(q);
  if (!s.files.length) { $(".page-body").innerHTML = '<p class="note">変わったファイルは無い</p>'; return; }
  $("h2").textContent = s.title;
  $(".sub").textContent = `${s.sub} · ${s.files.length} ファイル`;
  const add = s.files.reduce((n, f) => n + (f.add ?? 0), 0), del = s.files.reduce((n, f) => n + (f.del ?? 0), 0);
  $(".counts").innerHTML = `<i class="n-add">+${add}</i> <i class="n-del">−${del}</i>`;
  const hasMd = s.files.some((f) => isMarkdown(f.path));
  $(".md-seg").hidden = !hasMd;
  let view = null;
  const sync = () => {
    for (const b of el.querySelectorAll(".md-seg button")) b.setAttribute("aria-pressed", String((b.dataset.md === "on") === mdOn()));
    $(".wrap").hidden = s.files.every((f) => isMarkdown(f.path)) && mdOn();
  };
  const draw = (k) => { sync(); view = stream(el, r, ctx, s, k, mdOn()); };
  for (const b of el.querySelectorAll(".view-seg button")) {
    b.onclick = () => b.dataset.v === "file" && ctx.go({ ...s.route(view.current()), v: "file" }, { replace: true });
  }
  for (const b of el.querySelectorAll(".md-seg button")) {
    b.onclick = () => {
      if ((b.dataset.md === "on") === mdOn()) return;
      try { localStorage.setItem("md", b.dataset.md); } catch { /* 今だけ切り替わる */ }
      draw(s.files.indexOf(view.current())); // 読んでいたファイルの頭から描き直す
    };
  }
  draw(i);
}
