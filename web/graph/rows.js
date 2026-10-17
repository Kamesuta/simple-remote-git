// 行とチップの HTML を作る。見た目は Design キャンバス(Main.dc.html)のとおり。
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// 見出しは GitHub のリポ名(無ければフォルダ名)。my-app のようにフォルダ名と違うことがある。
// 束ねるフォルダの下のリポ(games/server)は、チップが長くならないよう末尾だけ
export const label = (r) => (r.github ?? r.name).split("/").pop();

export function ago(t) {
  const d = Math.max(0, Date.now() / 1000 - t);
  if (d < 60) return "たった今";
  if (d < 3600) return `${Math.floor(d / 60)} 分前`;
  if (d < 86400) return `${Math.floor(d / 3600)} 時間前`;
  if (d < 86400 * 365) return `${Math.floor(d / 86400)} 日前`;
  return `${Math.floor(d / 86400 / 365)} 年前`;
}

// ---- チップ ----
const ICON = {
  folder: '<svg width="11" height="11" viewBox="0 0 24 24" role="img" aria-label="ワークツリー"><path d="M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/></svg>',
  tag: '<svg width="10" height="10" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h8l10 10-8 8L3 11z"/></svg>',
  cloud: '<svg width="11" height="11" viewBox="0 0 24 24" role="img" aria-label="origin と同じ"><path d="M7 18h10a4 4 0 0 0 .6-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18z"/></svg>',
  box: '<svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h18v4H3zM5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4"/></svg>',
};
const RANK = { head: 0, wt: 1, local: 2, remote: 3, tag: 4 };

// local と同名の origin が同じコミットにあれば 1 枚にまとめて雲の印。ワークツリーを先に並べる
function chips(refs) {
  const mine = new Set(refs.filter((r) => r.t === "local" || r.t === "head").map((r) => r.n));
  const out = [];
  for (const r of refs) {
    if (r.t === "remote") {
      const short = r.n.slice(r.n.indexOf("/") + 1);
      if (short === "HEAD" || mine.has(short)) continue;
      out.push({ k: "remote", n: r.n });
    } else if (r.t === "head" || r.t === "local") {
      const sync = refs.some((x) => x.t === "remote" && x.n.endsWith(`/${r.n}`));
      out.push({ k: r.t === "head" ? "head" : r.wt ? "wt" : "local", n: r.n, sync, folder: !!r.wt });
    } else if (r.t === "wt") {
      out.push({ k: "wt", n: r.n, folder: true });
    } else {
      out.push({ k: "tag", n: r.n });
    }
  }
  out.sort((a, b) => RANK[a.k] - RANK[b.k]);
  const html = out.slice(0, 2).map((c) =>
    `<span class="chip ${c.k}">${c.folder ? ICON.folder : ""}${c.k === "tag" ? ICON.tag : ""}<span>${esc(c.n)}</span>${c.sync ? ICON.cloud : ""}</span>`);
  if (out.length > 2) html.push(`<span class="more">+${out.length - 2}</span>`);
  return html.join("");
}

// ---- 行 ----
function wipCounts(c) {
  const parts = [];
  if (c.staged) parts.push(`ステージ済み ${c.staged}`);
  if (c.modified) parts.push(`変更 ${c.modified}`);
  if (c.untracked) parts.push(`新規 ${c.untracked}`);
  return parts.join(" · ");
}

export function rowHtml(c, pad, github) {
  const style = `style="padding-left:${pad}px"`;
  if (c.kind === "wip") {
    return `<div class="row wip" ${style}><div class="txt"><div class="subj">未コミットの変更</div>
      <div class="meta"><span class="chip wt">${ICON.folder}<span>${esc(c.wt)}</span></span><span class="who">${wipCounts(c)}</span></div></div></div>`;
  }
  if (c.kind === "stash") {
    return `<div class="row stash" ${style}><div class="txt"><div class="subj">${esc(c.s)}</div>
      <div class="meta"><span class="chip stash">${ICON.box}<span>${esc(c.name)}</span></span><span class="who">${esc(c.on)}</span><span class="end">${ago(c.at)}</span></div></div></div>`;
  }
  const head = c.refs.some((r) => r.t === "head");
  const inner = `<div class="txt"><div class="subj">${esc(c.s)}</div>
    <div class="meta">${chips(c.refs)}<span class="who">${esc(c.an)} · ${ago(c.at)}</span><span class="end sha">${c.h.slice(0, 7)}</span></div></div>`;
  const cls = `row${head ? " head" : ""}`;
  // GitHub が無いリポ(origin 無し)は開く先が無いので、リンクにしない
  return github
    ? `<a class="${cls}" ${style} href="${esc(github)}/commit/${c.h}" target="_blank" rel="noopener">${inner}</a>`
    : `<div class="${cls}" ${style}>${inner}</div>`;
}
