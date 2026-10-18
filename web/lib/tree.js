// ファイルの並び(パス)をフォルダの木にする。中身がフォルダ 1 つだけのフォルダは
// `web/views` のように 1 行に畳む(VS Code と同じ。狭い画面で段が深くならないように)。
// ブラウザでも node --test でも読めるよう、DOM には触らない。

export function buildTree(files) {
  const root = { name: "", path: "", dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.split("/");
    let node = root;
    for (const d of parts.slice(0, -1)) {
      if (!node.dirs.has(d)) node.dirs.set(d, { name: d, path: node.path ? `${node.path}/${d}` : d, dirs: new Map(), files: [] });
      node = node.dirs.get(d);
    }
    node.files.push(f);
  }
  return compact(root);
}

const byName = (a, b) => a.name.localeCompare(b.name);

function compact(node) {
  let n = { name: node.name, path: node.path, dirs: [...node.dirs.values()], files: node.files };
  // ルートは畳まない(畳むと、いちばん上の段の名前が消える)
  while (n.path && n.dirs.length === 1 && n.files.length === 0) {
    const [only] = n.dirs;
    n = { name: `${n.name}/${only.name}`, path: only.path, dirs: [...only.dirs.values()], files: only.files };
  }
  return {
    name: n.name, path: n.path,
    dirs: n.dirs.map(compact).sort(byName),
    files: [...n.files].sort((a, b) => a.path.localeCompare(b.path)),
  };
}

// 画面に並べる順の行にする。閉じたフォルダ(path)は中を出さない。フォルダを先、ファイルを後。
// closed は Set か「閉じているか」を返す関数(ファイルのタブは、開いたものだけを覚えて残りを閉じる)
export function flatten(tree, closed = new Set(), depth = 0, out = []) {
  const shut = typeof closed === "function" ? closed : (p) => closed.has(p);
  for (const d of tree.dirs) {
    out.push({ type: "dir", name: d.name, path: d.path, depth, open: !shut(d.path) });
    if (!shut(d.path)) flatten(d, shut, depth + 1, out);
  }
  for (const f of tree.files) out.push({ type: "file", f, depth });
  return out;
}
