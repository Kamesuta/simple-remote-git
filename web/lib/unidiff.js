// unified 形式の差分(1 ファイル分)を行に分け、対になった消えた行と足した行は語単位の差も出す。
// ブラウザでも node --test でも読めるよう、DOM には触らない。

// 行は { t: "ctx" | "add" | "del", o: 元の行番号, n: 新しい行番号, s: 中身 }。
// `\ No newline at end of file` は直前の行に nonl を立てる
export function parse(text) {
  const hunks = [];
  let cur = null, o = 0, n = 0;
  for (const line of text.split("\n")) {
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/.exec(line);
    if (m) {
      o = +m[1];
      n = +m[2];
      cur = { header: line, ctx: m[3], lines: [] };
      hunks.push(cur);
      continue;
    }
    if (!cur) continue; // diff --git / index / --- / +++ の頭は読み飛ばす
    if (line.startsWith("\\")) {
      if (cur.lines.length) cur.lines[cur.lines.length - 1].nonl = true;
    } else if (line.startsWith("+")) cur.lines.push({ t: "add", n: n++, s: line.slice(1) });
    else if (line.startsWith("-")) cur.lines.push({ t: "del", o: o++, s: line.slice(1) });
    // git は空の文脈行も " " で出すので、本当に空の行は末尾の改行の名残。読み飛ばす
    else if (line.startsWith(" ")) cur.lines.push({ t: "ctx", o: o++, n: n++, s: line.slice(1) });
  }
  return hunks;
}

// 語に切る。英数字のかたまり・空白のかたまり・それ以外は 1 文字ずつ(日本語は 1 文字が 1 語)
const tokens = (s) => s.match(/[A-Za-z0-9_]+|\s+|[^A-Za-z0-9_\s]/g) ?? [];

// a と b の語の差。返すのは [{ s, ch }](ch = 変わった語)の列を a 側・b 側それぞれ。
// 似ていない行どうし(共通が 4 割未満)は語の差を出さない(全部塗ると読みにくいだけなので)
export function wordDiff(a, b) {
  const x = tokens(a), y = tokens(b);
  if (x.length * y.length > 160000) return null; // 長すぎる行は表を作らない
  const L = Array.from({ length: x.length + 1 }, () => new Uint16Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const same = L[0][0];
  if (same < 0.4 * Math.max(x.length, y.length)) return null;
  const A = [], B = [];
  const push = (arr, s, ch) => {
    const last = arr[arr.length - 1];
    if (last && last.ch === ch) last.s += s;
    else arr.push({ s, ch });
  };
  let i = 0, j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) { push(A, x[i++], false); push(B, y[j++], false); }
    else if (j < y.length && (i === x.length || L[i][j + 1] >= L[i + 1][j])) push(B, y[j++], true);
    else push(A, x[i++], true);
  }
  return { a: glue(A), b: glue(B) };
}

// 変わった語のあいだに挟まった 2 文字以下の変わっていない部分(`(`・`, ` など)は、つなげて塗る。
// 飛び飛びに塗ると、どこが変わったのかかえって読みにくいため
function glue(segs) {
  const out = [];
  for (let k = 0; k < segs.length; k++) {
    const g = segs[k];
    const bridge = !g.ch && g.s.length <= 2 && out.length && out[out.length - 1].ch && segs[k + 1]?.ch;
    if ((g.ch || bridge) && out.length && out[out.length - 1].ch) out[out.length - 1].s += g.s;
    else out.push({ ...g, ch: g.ch || !!bridge });
  }
  return out;
}

// 消えた行の並びの直後に足した行の並びが来たら、上から順に対にして語の差を付ける
export function pairWords(lines) {
  for (let i = 0; i < lines.length;) {
    if (lines[i].t !== "del") { i++; continue; }
    let d = i;
    while (d < lines.length && lines[d].t === "del") d++;
    let a = d;
    while (a < lines.length && lines[a].t === "add") a++;
    for (let k = 0; k < Math.min(d - i, a - d); k++) {
      const w = wordDiff(lines[i + k].s, lines[d + k].s);
      if (w) { lines[i + k].w = w.a; lines[d + k].w = w.b; }
    }
    i = a;
  }
  return lines;
}
