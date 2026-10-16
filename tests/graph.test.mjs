// レーン割り付けの形を確かめる。行は上が新しい(git log --topo-order と同じ並び)
import { test } from "node:test";
import assert from "node:assert/strict";
import { layout } from "../web/graph.js";

const C = (h, ...p) => ({ h, p });
const cols = (lay) => lay.rows.map((r) => r.col);

test("直線は 1 レーン", () => {
  const lay = layout([C("c", "b"), C("b", "a"), C("a")]);
  assert.deepEqual(cols(lay), [0, 0, 0]);
  assert.equal(lay.width, 1);
  assert.equal(lay.rows[0].lines.length, 1); // 先端は上から線が来ない
  assert.equal(lay.rows[2].lines.length, 1); // 根は下へ線が出ない
});

test("分岐:2 本の先端が同じ親で合わさる", () => {
  // main: m2 → base, feat: f1 → base
  const lay = layout([C("m2", "base"), C("f1", "base"), C("base")]);
  assert.deepEqual(cols(lay), [0, 1, 0]);
  assert.equal(lay.width, 2);
  // base の行:レーン 1 から点(レーン 0)へ寄る線がある
  assert.ok(lay.rows[2].lines.some((l) => l.x1 === 1 && l.y1 === 0 && l.x2 === 0 && l.y2 === 0.5));
});

test("合流:マージコミットの第 2 親は別レーン", () => {
  const lay = layout([C("M", "m1", "f1"), C("f1", "m0"), C("m1", "m0"), C("m0")]);
  assert.deepEqual(cols(lay), [0, 1, 0, 0]);
  assert.ok(lay.rows[0].merge);
  assert.ok(lay.rows[0].lines.some((l) => l.x1 === 0 && l.x2 === 1 && l.y2 === 1));
  // 合流先が終わったらレーンが空いて幅が戻る
  assert.equal(lay.width, 2);
});

test("タコ足マージは親の数だけレーンを開く", () => {
  const lay = layout([C("O", "a", "b", "c"), C("c", "r"), C("b", "r"), C("a", "r"), C("r")]);
  assert.deepEqual(cols(lay), [0, 2, 1, 0, 0]);
  assert.equal(lay.width, 3);
  assert.equal(lay.rows[0].lines.filter((l) => l.y1 === 0.5).length, 3);
});

test("空いたレーンは使い回す", () => {
  // 1 本目の枝が閉じたあとに出てきた枝は、閉じたレーンに入る
  const lay = layout([
    C("x", "m"), C("t1", "m"), C("m", "n"), C("t2", "n"), C("n"),
  ]);
  assert.deepEqual(cols(lay), [0, 1, 0, 1, 0]);
  assert.equal(lay.width, 2);
});

test("範囲外の親はレーンを持ったまま最後まで下へ伸びる", () => {
  const lay = layout([C("b", "a"), C("z", "y")]);
  assert.deepEqual(cols(lay), [0, 1]);
  assert.ok(lay.rows[1].lines.some((l) => l.x1 === 0 && l.x2 === 0 && l.y1 === 0 && l.y2 === 1));
});

test("未コミットの変更は点線で HEAD につながり、枝の色を奪わない", () => {
  const lay = layout([{ h: "wip:main", p: ["b"], wip: true }, C("b", "a"), C("a")]);
  assert.deepEqual(cols(lay), [0, 0, 0]);
  assert.ok(lay.rows[0].wip);
  assert.ok(lay.rows[0].lines.every((l) => l.dash && l.c === -1));
  // b からは実線で、未コミットとは別の色
  assert.ok(lay.rows[1].lines.some((l) => l.y1 === 0 && l.dash));
  assert.ok(lay.rows[1].lines.some((l) => l.y1 === 0.5 && !l.dash && l.c >= 0));
  assert.equal(lay.rows[2].lines.find((l) => l.y1 === 0).dash, false);
});

test("ほかの枝も待っている HEAD には、ふつうの枝のレーンで着く", () => {
  // x → b の枝(レーン 0)があるところへ、b の真上に未コミットを置く
  const lay = layout([C("x", "b"), { h: "wip:wt", p: ["b"], wip: true }, C("b")]);
  assert.deepEqual(cols(lay), [0, 1, 0]);
  assert.ok(lay.rows[2].lines.some((l) => l.x1 === 1 && l.x2 === 0 && l.dash));
  assert.equal(lay.rows[2].color, lay.rows[0].color);
});

test("スタッシュも kind で点線になり、行に kind が残る", () => {
  const lay = layout([{ kind: "stash", h: "stash@{0}", p: ["b"] }, { kind: "commit", h: "b", p: ["a"] }, C("a")]);
  assert.deepEqual(lay.rows.map((r) => r.kind), ["stash", "commit", "commit"]);
  assert.ok(lay.rows[0].lines.every((l) => l.dash));
  assert.ok(lay.rows[1].color >= 0);
});
