// 整形した HTML どうしの差(Markdown の Rich Diff 用)。GitHub と同じく、足した語を <ins>、消した語を <del> で包む。
// まず塊(段落・見出し・表・リスト…)の単位で比べ、対になった塊の中だけを語の単位で比べる
// (文書全体を語で比べると表が大きくなりすぎるうえ、関係ない段落どうしが混ざるため)。
// ブラウザでも node --test でも読めるよう、DOM には触らない(塊への分け方は呼ぶ側が渡す)。

const TOKEN = /<[^>]+>|&[#a-zA-Z0-9]+;|[A-Za-z0-9_]+|\s+|[^<&\sA-Za-z0-9_]/g;
const isTag = (t) => t[0] === "<";
const tagName = (html) => /^<([a-z0-9]+)/i.exec(html)?.[1]?.toLowerCase();

// 2 つの並びの最長共通部分から、{ op: "eq" | "del" | "ins", v } の並びを作る
function lcsOps(x, y, same = (a, b) => a === b) {
  const L = Array.from({ length: x.length + 1 }, () => new Uint32Array(y.length + 1));
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      L[i][j] = same(x[i], y[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && same(x[i], y[j])) { ops.push({ op: "eq", v: y[j], w: x[i] }); i++; j++; }
    // 同点なら消した側を先に(GitHub と同じく「消した → 足した」の順に並べるため)
    else if (i < x.length && (j === y.length || L[i + 1][j] >= L[i][j + 1])) ops.push({ op: "del", v: x[i++] });
    else ops.push({ op: "ins", v: y[j++] });
  }
  return ops;
}

// 塊の中を語で比べる。消した側のタグは捨て(入れ子が崩れるため)、文字だけを <del> に入れる。
// 日本語は 1 文字が 1 語なので、変わった文字にはさまれた 2 文字以下の同じ部分はつなげて、
// 「押す → 長押しする」を「<del>押す</del><ins>長押しする</ins>」のように 1 か所にまとめる
export function inlineDiff(a, b) {
  const x = a.match(TOKEN) ?? [], y = b.match(TOKEN) ?? [];
  if (x.length * y.length > 2_000_000) return null;
  const ops = lcsOps(x, y);
  const changed = (o) => o && o.op !== "eq" && !isTag(o.v);
  const glued = ops.flatMap((o, k) => (o.op === "eq" && !isTag(o.v) && o.v.length <= 2 && changed(ops[k - 1]) && changed(ops[k + 1])
    ? [{ op: "del", v: o.v }, { op: "ins", v: o.v }] : [o]));
  const out = [];
  let dels = [], ins = [];
  const flush = () => {
    if (dels.length) out.push(`<del>${dels.join("")}</del>`);
    if (ins.length) out.push(`<ins>${ins.join("")}</ins>`);
    dels = []; ins = [];
  };
  for (const { op, v } of glued) {
    if (isTag(v)) {
      if (op === "del") continue;
      flush();
      out.push(v);
    } else if (op === "eq") { flush(); out.push(v); }
    else (op === "del" ? dels : ins).push(v);
  }
  flush();
  return out.join("");
}

// 2 つの塊の文字が半分以上同じか(タグは見ない)。消した塊と足した塊を組にしてよいかの目安。
// 2 文字ずつの並びで数える(日本語を 1 文字ずつ数えると「ス」「マ」のようにどの行にもある字で似ていると出すぎるため)
function similar(a, b) {
  const words = (h) => {
    const text = (h.match(TOKEN) ?? []).filter((t) => !isTag(t)).join("").replace(/\s+/g, "");
    return Array.from({ length: Math.max(0, text.length - 1) }, (_, i) => text.slice(i, i + 2));
  };
  const x = words(a), y = words(b);
  if (!x.length || !y.length) return false;
  const count = new Map();
  for (const t of x) count.set(t, (count.get(t) ?? 0) + 1);
  let common = 0;
  for (const t of y) if (count.get(t) > 0) { common++; count.set(t, count.get(t) - 1); }
  return common >= 0.5 * Math.max(x.length, y.length);
}

// 要素の最初のタグに class を足す(印は外に div をかぶせず要素そのものに付ける。表の行を div で包むと表が崩れるため)
export function mark(html, cls) {
  return html.replace(/^<([a-z0-9]+)([^>]*)>/i, (m, tag, attrs) => (/\sclass="/.test(attrs)
    ? m.replace(/class="/, `class="${cls} `) : `<${tag} class="${cls}"${attrs}>`));
}

// 塊の並びどうしを比べ、変わった塊は語の差、対の無い塊は丸ごと足した・消した印を付けた HTML にする。
// split(html) はリスト・表・引用のような入れ物を { open, close, children } に分ける(DOM が要るので呼ぶ側が渡す)。
// 入れ物どうしは中の項目の単位でさらに比べる(長いリストの 1 項目を直しただけで、全体が消して足したにならないように)
export function blockDiff(oldBlocks, newBlocks, split = () => null) {
  const ops = lcsOps(oldBlocks, newBlocks);
  const out = [];
  for (let k = 0; k < ops.length;) {
    if (ops[k].op === "eq") { out.push(ops[k++].v); continue; }
    const dels = [], ins = [];
    while (k < ops.length && ops[k].op !== "eq") (ops[k].op === "del" ? dels : ins).push(ops[k++].v);
    // 消した塊と足した塊を、並び順ではなく中身が似ているものどうしで組にする
    // (表に行を足したとき、古い行が関係ない新しい行と組になって塗りが乱れないように)
    const pairable = (d, a) => tagName(d) === tagName(a) && ((split(d) && split(a)) || similar(d, a));
    for (const { op, v, w } of lcsOps(dels, ins, pairable)) {
      if (op === "del") { out.push(mark(v, "rd-del")); continue; }
      if (op === "ins") { out.push(mark(v, "rd-add")); continue; }
      const d = w, sd = split(d), sa = split(v);
      if (sd && sa) { out.push(sa.open + blockDiff(sd.children, sa.children, split) + sa.close); continue; }
      const merged = inlineDiff(d, v);
      out.push(...(merged ? [mark(merged, "rd-mod")] : [mark(d, "rd-del"), mark(v, "rd-add")]));
    }
  }
  return out.join("");
}
