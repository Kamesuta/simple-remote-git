// コミット列(topo 順)をレーンに割り付け、縦長の SVG 1 枚に描く。
// ブラウザでも node --test でも読めるよう、DOM に触るのは render だけにする。

// 各レーンは「次にここへ来るはずのコミット」を持つ。
// コミットが来たら、待っていたレーンのうち左端に置き、残りは合流線にして閉じる。
// 第 1 親はそのレーンを継ぐ。残りの親は、もう誰かが待っていればそこへ、いなければ空きレーンへ
// (第 2 親以降でレーンを増やすと、同じ枝を何度もマージしたときに幅が広がり続けるため)。
// 線は行ごとに {x1,y1,x2,y2,c,dash} で持つ(x はレーン番号、y は行の中で 0=上 0.5=点 1=下)。
// kind が wip(未コミットの変更)か stash の行は、親の真上に置いておけば、親までの線が点線になる。
export function layout(commits) {
  let lanes = []; // レーン番号 → 待っているハッシュ(空きは null)
  let colors = []; // レーン番号 → 色番号。枝ごとに色を変えたいのでレーン番号とは別に持つ
  let dashed = []; // レーン番号 → 未コミットの変更から伸びている線か
  let nextColor = 0;
  let width = 0;
  const rows = [];

  const freeLane = () => {
    const i = lanes.indexOf(null);
    return i === -1 ? lanes.length : i;
  };

  for (const c of commits) {
    const kind = c.kind ?? (c.wip ? "wip" : "commit");
    const wip = kind !== "commit";
    const lines = [];
    const waiting = [];
    lanes.forEach((h, k) => { if (h === c.h) waiting.push(k); });

    let col;
    if (waiting.length) {
      // 未コミットの点線より、ふつうの枝のレーンを継ぐ
      col = waiting.find((k) => !dashed[k]) ?? waiting[0];
    } else {
      col = freeLane();
    }
    if ((!waiting.length || dashed[col]) && !wip) {
      // 先端(か、未コミットの変更だけが待っていた枝)。新しい色で始める
      colors[col] = nextColor++;
    }
    const fromDash = lanes.map((_, k) => !!dashed[k]);
    dashed[col] = wip;
    const color = wip ? -1 : colors[col]; // 未コミットは色を持たない(-1 = 地味な色で描く)

    // 上から来る線:待っていたレーンは点へ寄せ、関係ないレーンはまっすぐ通す
    lanes.forEach((h, k) => {
      if (h === null || h === undefined) return;
      const line = h === c.h ? { x1: k, y1: 0, x2: col, y2: 0.5 } : { x1: k, y1: 0, x2: k, y2: 1 };
      lines.push({ ...line, c: fromDash[k] ? -1 : colors[k], dash: fromDash[k] });
    });
    for (const k of waiting) if (k !== col) { lanes[k] = null; dashed[k] = false; }

    // 下へ出る線
    const [first, ...rest] = c.p;
    if (first === undefined) {
      lanes[col] = null; // 根
      dashed[col] = false;
    } else {
      // 同じ親を別のレーンが待っていても寄せない。親の行で左端へまとめるほうが本流がずれない
      lanes[col] = first;
      lines.push({ x1: col, y1: 0.5, x2: col, y2: 1, c: color, dash: wip });
    }
    for (const p of rest) {
      let j = lanes.indexOf(p);
      if (j === -1) {
        j = freeLane();
        lanes[j] = p;
        dashed[j] = false;
        colors[j] = nextColor++;
      }
      lines.push({ x1: col, y1: 0.5, x2: j, y2: 1, c: colors[j], dash: false });
    }

    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
    width = Math.max(width, lanes.length, col + 1);
    rows.push({ col, color, kind, merge: c.p.length > 1, wip, lines });
  }
  return { rows, width };
}

// SVG の中身(文字列)を返す。lane: レーン幅 px、row: 行の高さ px、heads: HEAD のある行番号の Set。
// 色は CSS の変数で付ける(ライト/ダークを CSS だけで切り替えるため)。
// 斜めの線は縦向きの S 字にする(行が縦に詰まっていても線が読みやすい)
export function render(lay, { lane = 12, row = 64, heads = new Set(), palette = 8 } = {}) {
  const X = (k) => 8 + k * lane;
  const cls = (c) => (c < 0 ? "g-wip" : `g-c${c % palette}`);
  const lines = [];
  const nodes = [];
  lay.rows.forEach((r, i) => {
    const top = i * row;
    for (const l of r.lines) {
      const x1 = X(l.x1), y1 = top + l.y1 * row, x2 = X(l.x2), y2 = top + l.y2 * row, my = (y1 + y2) / 2;
      const d = x1 === x2 ? `M${x1} ${y1}V${y2}` : `M${x1} ${y1}C${x1} ${my} ${x2} ${my} ${x2} ${y2}`;
      lines.push(`<path class="g-line ${cls(l.c)}${l.dash ? " g-dash" : ""}" d="${d}"/>`);
    }
    const x = X(r.col), y = top + row / 2;
    if (r.kind === "stash") nodes.push(`<rect class="g-stash" x="${x - 5}" y="${y - 5}" width="10" height="10" rx="2"/>`);
    else if (r.kind === "wip") nodes.push(`<circle class="g-wipdot" cx="${x}" cy="${y}" r="5"/>`);
    else if (r.merge) nodes.push(`<circle class="g-merge ${cls(r.color)}" cx="${x}" cy="${y}" r="4"/>`);
    else nodes.push(`<circle class="g-dot ${cls(r.color)}" cx="${x}" cy="${y}" r="${heads.has(i) ? 6 : 4.5}"/>`);
  });
  return { markup: lines.join("") + nodes.join(""), width: X(lay.width - 1) + 8, height: lay.rows.length * row };
}
