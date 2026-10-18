// # と画面の状態の往復、差分の分解と語単位の差を確かめる
import { test } from "node:test";
import assert from "node:assert/strict";
import { build, parse, parent, tabOf } from "../web/lib/route.js";
import { pairWords, parse as parseDiff, wordDiff } from "../web/lib/unidiff.js";

test("# は往復しても同じ状態に戻る(/ を含むリポ名とパスも)", () => {
  const cases = [
    { repo: "my-app", view: "graph" },
    { repo: "games/server", view: "changes", wt: "feat-x" },
    { repo: "r", view: "commit", h: "a1b2c3d" },
    { repo: "r", view: "diff", src: "commit", h: "a1b2c3d", path: "web/新しい app.js", v: "file", old: "web/old.js" },
    { repo: "r", view: "stash", name: "stash@{2}" },
    { repo: "r", view: "diff", src: "stash", name: "stash@{0}", path: "a.txt" },
    { repo: "r", view: "diff", src: "unstaged", wt: "作業ツリー", path: "docs/README.md" },
    { repo: "r", view: "diff", src: "open", ref: "wt:feat-x", path: "a/b.py", line: "42", v: "file" },
    { repo: "r", view: "search" },
    { repo: "r", view: "files", ref: "wt:feat-x" },
    { repo: "r", view: "history", ref: "a1b2c3d", path: "web/app.js" },
  ];
  for (const r of cases) assert.deepEqual(parse(build(r)), r);
});

test("知らない形はグラフに落とす", () => {
  assert.deepEqual(parse("#/r/w/x/weird/a"), { repo: "r", view: "graph" });
  assert.deepEqual(parse(""), { repo: null, view: "graph" });
});

test("戻る先とタブ", () => {
  assert.equal(tabOf({ view: "diff", src: "staged" }), "changes");
  assert.equal(tabOf({ view: "commit" }), "graph");
  assert.deepEqual(parent({ repo: "r", view: "diff", src: "commit", h: "abc1" }), { repo: "r", view: "commit", h: "abc1" });
  assert.deepEqual(parent({ repo: "r", view: "diff", src: "staged", wt: "w" }), { repo: "r", view: "changes", wt: "w" });
  assert.deepEqual(parent({ repo: "r", view: "commit", h: "abc1" }), { repo: "r", view: "graph" });
  assert.deepEqual(parent({ repo: "r", view: "diff", src: "open", ref: "wt:x", path: "a" }), { repo: "r", view: "files" });
  assert.equal(tabOf({ view: "history" }), "files");
});

const DIFF = `diff --git a/a.py b/a.py
index 1..2 100644
--- a/a.py
+++ b/a.py
@@ -48,4 +48,5 @@ def do_GET(self):
 if x:
-    return self._json(404, NG)
+    return self._route(u, q)
+    # 足した
 end
\\ No newline at end of file
`;

test("unified を行に分け、行番号を振る", () => {
  const [h] = parseDiff(DIFF);
  assert.equal(h.ctx, "def do_GET(self):");
  assert.deepEqual(h.lines.map((l) => [l.t, l.o ?? null, l.n ?? null]),
    [["ctx", 48, 48], ["del", 49, null], ["add", null, 49], ["add", null, 50], ["ctx", 50, 51]]);
  assert.ok(h.lines[4].nonl);
});

test("対になった行は変わった語だけ印が付く。似ていない行には付けない", () => {
  const [h] = parseDiff(DIFF);
  pairWords(h.lines);
  const changed = (w) => w.filter((x) => x.ch).map((x) => x.s).join("|");
  assert.equal(changed(h.lines[1].w), "_json(404, NG");
  assert.equal(changed(h.lines[2].w), "_route(u, q");
  assert.equal(h.lines[3].w, undefined);
  assert.equal(wordDiff("まったく別の文", "something else entirely"), null);
});
