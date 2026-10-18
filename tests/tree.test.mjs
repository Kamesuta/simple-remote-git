// 変更のタブの木(畳み・並び・閉じたフォルダ)を確かめる
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTree, flatten } from "../web/lib/tree.js";

const F = (...paths) => paths.map((path) => ({ path }));
const show = (rows) => rows.map((r) => `${"  ".repeat(r.depth)}${r.type === "dir" ? `${r.name}/` : r.f.path.split("/").pop()}`);

test("中身がフォルダ 1 つだけのフォルダは 1 行に畳む", () => {
  const rows = flatten(buildTree(F("web/views/diff.js", "web/views/files.js")));
  assert.deepEqual(show(rows), ["web/views/", "  diff.js", "  files.js"]);
  assert.equal(rows[0].path, "web/views");
});

test("ファイルを持つフォルダは畳まない。フォルダが先、名前の順", () => {
  const rows = flatten(buildTree(F("web/style.css", "web/graph/rows.js", "README.md", "web/app.js")));
  assert.deepEqual(show(rows), ["web/", "  graph/", "    rows.js", "  app.js", "  style.css", "README.md"]);
});

test("閉じたフォルダは中を出さない", () => {
  const rows = flatten(buildTree(F("a/b/c.txt", "a/d.txt")), new Set(["a"]));
  assert.deepEqual(show(rows), ["a/"]);
  assert.equal(rows[0].open, false);
});

test("中をまだ読んでいないフォルダは、空でもフォルダとして出す(親とは畳んでも印は引き継ぐ)", () => {
  const rows = flatten(buildTree([{ path: "a.txt" }, { path: "docs", dir: true, lazy: true, ignored: true }, { path: "x/y", dir: true, lazy: true }]));
  assert.deepEqual(rows.map((r) => [r.type, r.name ?? r.f.path, !!r.lazy, !!r.ignored]),
    [["dir", "docs", true, true], ["dir", "x/y", true, false], ["file", "a.txt", false, false]]);
});
