// 探す欄。Claude の返事などからコピーしたパスを貼ると、1 つに決まればそのままファイル表示で開く。
// 差分が見たければ、開いた先の「差分 / ファイル」で切り替える(開く前には選ばせない)。
// 名前の一部で探すのは 2 段階目。いまはパスとして読めるものだけを扱う。
import { esc } from "../graph/rows.js";
import { api, q } from "../lib/api.js";

const EXAMPLES = [
  ["docs/README.md", "いま見ているリポの中のパス"],
  ["~/softdata/git/my-app/…", "フルパス。別のリポでも開く"],
  [".claude/worktrees/feat-x/web/app.js", "ワークツリーの中の版で開く"],
  ["web/app.js:120", "行番号付きならその行へ"],
];

const examplesHtml = () => `<h4 class="part">こんな形を貼れる</h4>`
  + EXAMPLES.map(([a, b]) => `<div class="ex"><code>${esc(a)}</code><small>${b}</small></div>`).join("");

function cardHtml(m, i, current) {
  const ver = m.main ? "作業中(本体)" : `作業中(${m.wt})`;
  return `<button type="button" class="res-card${m.exists ? "" : " missing"}" data-i="${i}">
    <span class="k">リポ</span><span>${esc(m.repo)}${m.repo !== current ? " に切り替える" : ""}</span>
    <span class="k">版</span><span>${esc(ver)}</span>
    <span class="k">ファイル</span><b>${esc(m.path)}${m.line ? ` · ${m.line} 行目` : ""}</b>
    ${m.exists ? "" : '<span class="k"></span><span class="miss">この場所にファイルが無い</span>'}</button>`;
}

export function searchPage(r, ctx) {
  const el = document.createElement("section");
  el.className = "page search";
  el.innerHTML = `
    <header class="page-top">
      <button type="button" class="back" aria-label="閉じる">‹</button>
      <input type="search" class="find" placeholder="パスを貼る(:行 も可)" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="go">
    </header>
    <div class="search-body">${examplesHtml()}</div>`;
  const input = el.querySelector(".find");
  const body = el.querySelector(".search-body");
  let seq = 0, timer = null, matches = [];
  // 開いたら探す欄をまた積まないよう置き換える(「戻る」でグラフに戻れるように)
  const open = (m) => ctx.go({ repo: m.repo, view: "diff", src: "open", ref: m.ref, path: m.path,
    line: m.line ? String(m.line) : undefined, v: "file" }, { replace: true });

  async function run(text, auto) {
    const my = ++seq;
    if (!text.trim()) { body.innerHTML = examplesHtml(); return; }
    body.innerHTML = '<p class="note">探しています…</p>';
    try {
      const res = await api(`/api/resolve?${q({ repo: r.repo, path: text })}`);
      if (my !== seq) return;
      matches = res.matches;
      const found = matches.filter((m) => m.exists);
      if (auto && found.length === 1) return open(found[0]);
      body.innerHTML = matches.length
        ? `<h4 class="part">パスとして読んだ</h4>${matches.map((m, i) => cardHtml(m, i, r.repo)).join("")}`
          + (matches.length > 1 ? '<p class="note">いくつかのリポに同じパスがあるので選ぶ</p>' : "")
        : '<p class="note">パスとして読めなかった(~/softdata/git の下のリポのファイルだけ開ける)</p>' + examplesHtml();
    } catch (e) {
      if (my === seq) body.innerHTML = `<p class="note err">${esc(e.message)}</p>`;
    }
  }

  el.querySelector(".back").onclick = () => ctx.back();
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => run(input.value, false), 250); });
  // 貼ったときは、1 つに決まればすぐ開く(打っている途中では開かない)
  input.addEventListener("paste", () => setTimeout(() => { clearTimeout(timer); run(input.value, true); }));
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const found = matches.filter((m) => m.exists);
    if (found.length === 1) open(found[0]);
    else run(input.value, true);
  });
  body.addEventListener("click", (e) => {
    const b = e.target.closest(".res-card[data-i]");
    if (b) open(matches[+b.dataset.i]);
  });
  setTimeout(() => input.focus());
  return el;
}
