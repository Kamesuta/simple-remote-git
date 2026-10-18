// Markdown の Rich Diff の比べ方(塊の単位 → 中は語の単位)を確かめる
import { test } from "node:test";
import assert from "node:assert/strict";
import { blockDiff, inlineDiff, mark } from "../web/lib/htmldiff.js";

test("語の差: 足した語は ins、消した語は del。タグは新しい側のまま残す", () => {
  assert.equal(inlineDiff("<p>起動丸を <b>押す</b></p>", "<p>起動丸を <b>長押しする</b></p>"),
    "<p>起動丸を <b><del>押す</del><ins>長押しする</ins></b></p>");
  // 消した側にだけあるタグは捨てる(入れ子が崩れないように)
  assert.equal(inlineDiff("<p>a <code>x</code> b</p>", "<p>a b</p>"), "<p>a <del>x </del>b</p>");
});

test("塊の差: 同じ塊はそのまま、変わった塊は中を比べ、対の無い塊は丸ごと印を付ける", () => {
  const out = blockDiff(["<h1>手引き</h1>", "<p>古い段落</p>", "<p>消える</p>"],
    ["<h1>手引き</h1>", "<p>新しい段落</p>", "<ul><li>足した</li></ul>"]);
  assert.equal(out, '<h1>手引き</h1>'
    + '<p class="rd-mod"><del>古</del><ins>新し</ins>い段落</p>'
    + '<p class="rd-del">消える</p><ul class="rd-add"><li>足した</li></ul>');
});

test("入れ物(リスト)どうしは中の項目の単位で比べる。印は項目そのものに付ける", () => {
  const split = (h) => (h.startsWith("<ul>") ? { open: "<ul>", close: "</ul>", children: h.slice(4, -5).match(/<li>.*?<\/li>/g) } : null);
  const out = blockDiff(["<ul><li>一</li><li>二</li><li>三</li></ul>"], ["<ul><li>一</li><li>二</li><li>3</li><li>四</li></ul>"], split);
  assert.equal(out, '<ul><li>一</li><li>二</li><li class="rd-del">三</li><li class="rd-add">3</li><li class="rd-add">四</li></ul>');
  assert.equal(mark('<td class="x" id="a">', "rd-add"), '<td class="rd-add x" id="a">');
});

test("足した行の前後でも、似ている行どうしを組にする(並び順だけで組にしない)", () => {
  const out = blockDiff(["<tr><td>起動丸の状態を確認できません</td></tr>"],
    ["<tr><td>インターネットにつながっていません</td></tr>", "<tr><td>起動丸の状態を確認できませんでした</td></tr>"]);
  assert.equal(out, '<tr class="rd-add"><td>インターネットにつながっていません</td></tr>'
    + '<tr class="rd-mod"><td>起動丸の状態を確認できません<ins>でした</ins></td></tr>');
});

test("文字の参照(&amp; など)は 1 語として扱い、途中で切らない", () => {
  assert.equal(inlineDiff("<p>A &amp; B</p>", "<p>A &amp; C</p>"), "<p>A &amp; <del>B</del><ins>C</ins></p>");
});
