// Markdown を GitHub と同じように整形する(marked + DOMPurify。どちらも web/vendor/ に置き、開いたときだけ読む)。
// 相対パスの画像はその版のファイルを API から読み、相対リンクはこのアプリの中で開く。
// Rich Diff は、前と後をそれぞれ整形してから塊・語の単位で比べる(lib/htmldiff.js)。
import { fileUrl } from "../../lib/api.js";
import { blockDiff } from "../../lib/htmldiff.js";
import { build } from "../../lib/route.js";

let libs = null;
const load = () => (libs ??= Promise.all([import("../../vendor/marked.esm.js"), import("../../vendor/purify.es.mjs")]));
const ALERTS = { NOTE: "メモ", TIP: "ヒント", IMPORTANT: "重要", WARNING: "注意", CAUTION: "警告" };

// dir(末尾 / 付き)からの相対パスを、リポの根からのパスにする
function join(dir, rel) {
  const out = [];
  for (const p of (rel.startsWith("/") ? rel : dir + rel).split("/")) {
    if (p === "..") out.pop();
    else if (p && p !== ".") out.push(p);
  }
  return out.join("/");
}

// at = { repo, ref, path }(その Markdown がどの版のどのファイルか)
function fixup(root, at) {
  const dir = at.path.slice(0, at.path.lastIndexOf("/") + 1);
  for (const img of root.querySelectorAll("img[src]")) {
    const src = img.getAttribute("src");
    if (/^(?:[a-z]+:|\/\/)/i.test(src)) continue;
    img.src = fileUrl(at.repo, at.ref, join(dir, decodeURI(src.split(/[?#]/)[0])));
    img.loading = "lazy";
  }
  for (const a of root.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href");
    if (href.startsWith("#")) continue;
    if (/^(?:[a-z]+:|\/\/)/i.test(href)) { a.target = "_blank"; a.rel = "noopener"; continue; }
    const path = join(dir, decodeURI(href.split("#")[0]));
    a.href = build({ repo: at.repo, view: "diff", src: "open", ref: at.ref, path, v: "file" });
  }
  // GitHub の囲み(> [!NOTE] など)
  for (const q of root.querySelectorAll("blockquote")) {
    const first = q.firstElementChild;
    const m = first?.tagName === "P" && /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(<br>)?/i.exec(first.innerHTML);
    if (!m) continue;
    const kind = m[1].toUpperCase();
    q.className = `md-alert md-${kind.toLowerCase()}`;
    first.innerHTML = first.innerHTML.slice(m[0].length);
    if (!first.innerHTML.trim()) first.remove();
    q.insertAdjacentHTML("afterbegin", `<p class="md-alert-title">${ALERTS[kind]}</p>`);
  }
}

// 整形して塊(いちばん上の段の要素)の並びにする。危ない HTML(script・on〜 など)は DOMPurify が落とす
async function blocks(text) {
  const [{ marked }, { default: purify }] = await load();
  const t = document.createElement("template");
  t.innerHTML = purify.sanitize(marked.parse(text ?? "", { gfm: true }));
  return [...t.content.children].map((e) => e.outerHTML);
}

function finish(html, at, cls) {
  const t = document.createElement("template");
  t.innerHTML = html;
  fixup(t.content, at);
  const wrap = document.createElement("div");
  wrap.className = cls;
  wrap.append(t.content);
  return wrap.outerHTML;
}

// リスト・表・引用のように、中身が要素だけの入れ物を分ける(Rich Diff で中の項目どうしを比べるため)
const CONTAINERS = new Set(["UL", "OL", "TABLE", "THEAD", "TBODY", "BLOCKQUOTE"]);
function split(html) {
  const t = document.createElement("template");
  t.innerHTML = html;
  const el = t.content.firstElementChild;
  if (!el || !CONTAINERS.has(el.tagName)) return null;
  if ([...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim())) return null;
  const outer = el.outerHTML;
  return { open: outer.slice(0, outer.indexOf(">") + 1), close: `</${el.tagName.toLowerCase()}>`, children: [...el.children].map((c) => c.outerHTML) };
}

export const isMarkdown = (path) => /\.(md|markdown|mdx)$/i.test(path);

export async function mdHtml(text, at) {
  return finish((await blocks(text)).join(""), at, "markdown");
}

// 画像やリンクの書き換えは比べたあとに 1 回だけ(先にすると、版ごとに URL が違って同じ段落まで「変わった」になる)
export async function mdDiffHtml(oldText, newText, at) {
  const [a, b] = await Promise.all([blocks(oldText), blocks(newText)]);
  return finish(blockDiff(a, b, split), at, "markdown rich");
}
