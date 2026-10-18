// 差分とファイルの中身を、行番号付きの行の並び(HTML の文字列)にする。
// 差分は unified(スマホの幅に左右 2 列は入らないため)。変わった語は <b> で太字と色にする。
import { esc } from "../../graph/rows.js";
import { pairWords, parse } from "../../lib/unidiff.js";

const SIGN = { add: "+", del: "−", ctx: "" };

function lineHtml(l) {
  const code = l.w ? l.w.map((x) => (x.ch ? `<b>${esc(x.s)}</b>` : esc(x.s))).join("") : esc(l.s);
  const nonl = l.nonl ? '<span class="nonl">改行なし</span>' : "";
  return `<div class="dl ${l.t}"><span class="ln">${l.o ?? ""}</span><span class="ln">${l.n ?? ""}</span>`
    + `<span class="sg">${SIGN[l.t]}</span><span class="code">${code || " "}${nonl}</span></div>`;
}

// 塊のあいだの、変わっていない行の数(畳んでいる分)。展開は 3 段階目
function gap(prev, next) {
  const last = [...prev.lines].reverse().find((l) => l.o != null);
  const first = next.lines.find((l) => l.o != null);
  return last && first ? first.o - last.o - 1 : 0;
}

export function diffHtml(d) {
  if (d.binary) return '<p class="note">バイナリのファイルなので差分は出せない。「ファイル」で中身を見る</p>';
  const hunks = parse(d.text);
  if (!hunks.length) return '<p class="note">中身は同じ(名前やモードだけが変わった)</p>';
  const out = [];
  hunks.forEach((h, i) => {
    if (i > 0) {
      const n = gap(hunks[i - 1], h);
      if (n > 0) out.push(`<div class="fold">⋯ ${n} 行は変わっていない</div>`);
    }
    out.push(`<div class="hunk">${esc(h.header)}</div>`);
    out.push(pairWords(h.lines).map(lineHtml).join(""));
  });
  if (d.truncated) out.push('<p class="note">長いので途中で打ち切った</p>');
  return out.join("");
}

export function fileHtml(text, truncated) {
  const lines = text.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines.map((s, i) => `<div class="fl" id="L${i + 1}"><button type="button" class="ln" data-n="${i + 1}">${i + 1}</button>`
    + `<span class="code">${esc(s) || " "}</span></div>`).join("")
    + (truncated ? '<p class="note">大きいので途中で打ち切った</p>' : "");
}
