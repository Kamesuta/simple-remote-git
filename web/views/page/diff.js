// 差分の画面。上の「差分 / ファイル」で、同じ版のファイル全体と行き来する(開く前には選ばせない)。
// 前後のファイルへは下のボタンか横スワイプ。切り替えと前後は履歴を積まない(「戻る」で一覧に戻れるように)。
import { esc } from "../../graph/rows.js";
import { fileUrl, getDiff, getFile } from "../../lib/api.js";
import { diffHtml, fileHtml } from "./diffbody.js";
import { isMarkdown, mdDiffHtml, mdHtml } from "./md.js";
import { changeNav, lines, swipe } from "./bars.js";
import { sources } from "./sources.js";

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
      <div class="seg"><button type="button" data-v="diff" aria-pressed="${mode === "diff"}">差分</button><button type="button" data-v="file" aria-pressed="${mode === "file"}">ファイル</button></div>
      <button type="button" class="wrap" aria-pressed="${wrapOn()}">折り返し</button>
      <button type="button" class="wrap md-btn" aria-pressed="${mdOn()}"${isMarkdown(r.path) ? "" : " hidden"}>整形</button>
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
  $(".sub").textContent = `${split(r.path)[1]} · ${s.title}`;
  $(".counts").innerHTML = f.add != null ? `<i class="n-add">+${f.add}</i> <i class="n-del">−${f.del ?? 0}</i>` : "";
  const hist = $(".hist-btn");
  hist.hidden = false;
  hist.onclick = () => ctx.go({ repo: r.repo, view: "history", ref: s.ref(f), path: r.path });
  const goFile = (g, v) => ctx.go({ ...s.route(g), v: v === "file" ? "file" : undefined }, { replace: true });
  for (const b of el.querySelectorAll(".seg button")) b.onclick = () => goFile(f, b.dataset.v);
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
  const md = $(".md-btn");
  md.onclick = () => {
    try { localStorage.setItem("md", mdOn() ? "off" : "on"); } catch { /* 今だけ切り替わる */ }
    md.setAttribute("aria-pressed", String(mdOn()));
    paint(el, r, ctx, mode, s, f).catch((e) => { $(".page-body").innerHTML = `<p class="note err">${esc(e.message)}</p>`; });
  };
  await paint(el, r, ctx, mode, s, f);
}

const textOf = async (repo, side) => (side ? (await getFile(repo, side.ref, side.path)).text ?? "" : "");

async function paint(el, r, ctx, mode, s, f) {
  const body = el.querySelector(".page-body");
  const md = isMarkdown(r.path) && mdOn();
  el.querySelector(".linebar").hidden = true;
  if (mode === "diff") {
    const args = s.diff(f);
    if (!args) { body.innerHTML = '<p class="note">差分にできるコミットが見つからない</p>'; return; }
    const note = args.note ? `<p class="note">${esc(args.note)}</p>` : "";
    if (md && s.pair(f)) {
      const p = s.pair(f);
      const [a, b] = await Promise.all([textOf(r.repo, p.old), textOf(r.repo, p.new)]);
      body.innerHTML = note + await mdDiffHtml(a, b, { repo: r.repo, ...(p.new ?? p.old) });
      changeNav(el);
      return;
    }
    const { note: _, ...a } = args;
    body.innerHTML = note + diffHtml(await getDiff(r.repo, a));
    return;
  }
  const ref = s.ref(f);
  if (IMAGE.test(r.path)) { body.innerHTML = `<img class="img" alt="${esc(r.path)}" src="${fileUrl(r.repo, ref, r.path)}">`; return; }
  const d = await getFile(r.repo, ref, r.path);
  if (d.binary) { body.innerHTML = `<p class="note">バイナリのファイル(${d.size} バイト)</p>`; return; }
  if (md) { body.innerHTML = await mdHtml(d.text, { repo: r.repo, ref, path: r.path }); return; }
  body.innerHTML = fileHtml(d.text, d.truncated);
  lines(el, r, ctx, d.sha);
}
