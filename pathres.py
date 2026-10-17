"""貼ったパスを {リポ, 版, パス, 行} に読み替える(探す欄用)。

Claude の返事などからコピーしたものをそのまま受けたいので、書き方の揺れを広く読む:
フルパス(`/Users/…`・`~/…`・`file://…`)、いま見ているリポの中のパス、`<リポ名>/…`、
`.claude/worktrees/<名>/…`、末尾の `:42`・`:42:7`・`#L42`、前後の引用符やバッククォート。
ワークツリーはリポの外(~/.claude など)にあることもあるので、git worktree list の場所と突き合わせる。
"""
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import gitdata
import worktree

_LINE = re.compile(r"(?::(\d+)(?::\d+)?|#L(\d+)(?:-L?\d+)?)$")
_MAX = 5


def split_line(text: str) -> tuple[str, int | None]:
    t = text.strip().strip("`'\"「」『』()<>").strip()
    t = t.removeprefix("file://")
    m = _LINE.search(t)
    if not m:
        return t, None
    return t[: m.start()], int(m[1] or m[2])


def _hit(repo: Path, wt: dict, rel: str, line: int | None) -> dict:
    return {"repo": repo.relative_to(gitdata.ROOT).as_posix(), "ref": f"wt:{wt['name']}", "wt": wt["name"],
            "main": wt["main"], "path": rel, "line": line, "exists": (Path(wt["path"]) / rel).is_file()}


def _roots() -> list[tuple[Path, dict, Path]]:
    """全リポの全ワークツリーの (リポ, ワークツリー, 場所)。1 回の読み替えで 1 度だけ作る。
    リポは 30 近くあるので並べて聞く(貼ってから開くまでを待たせないため)。"""
    repos = [r for _, r in gitdata.scan()]
    with ThreadPoolExecutor(max_workers=8) as ex:
        lists = list(ex.map(worktree.worktrees, repos))
    return [(repo, wt, Path(wt["path"]).resolve()) for repo, wts in zip(repos, lists) for wt in wts]


def _from_absolute(p: Path, line: int | None, roots) -> list[dict]:
    # 入れ子(本体の中の .claude/worktrees/…)があるので、いちばん深い場所を選ぶ
    inside = [t for t in roots if p == t[2] or t[2] in p.parents]
    if not inside:
        return []
    repo, wt, root = max(inside, key=lambda t: len(t[2].parts))
    return [_hit(repo, wt, p.relative_to(root).as_posix(), line)]


def _from_relative(rel: str, current: str | None, line: int | None, roots) -> list[dict]:
    rel = rel.removeprefix("./")
    repos = [r for _, r in gitdata.scan()]
    names = {r.relative_to(gitdata.ROOT).as_posix(): r for r in repos}
    # `<リポ名>/…` と書いてあれば、そのリポの中のパスとして読む(束ねたリポは名前に / を含む)
    for name in sorted(names, key=len, reverse=True):
        if rel.startswith(name + "/"):
            return _from_absolute((names[name] / rel[len(name) + 1:]).resolve(), line, roots)
    if current in names:  # いま見ているリポにあれば、それで決まり
        hit = _from_absolute((names[current] / rel).resolve(), line, roots)
        if hit and hit[0]["exists"]:
            return hit
    hits = []
    for repo in repos:  # 無ければほかのリポを最近使った順に。いくつも当たれば選ばせる
        hit = _from_absolute((repo / rel).resolve(), line, roots)
        if hit and hit[0]["exists"]:
            hits += hit
        if len(hits) >= _MAX:
            break
    return hits


def resolve(text: str, current: str | None = None) -> dict:
    path, line = split_line(text)
    if not path or "\0" in path:
        return {"input": text, "matches": []}
    if path.startswith("~"):
        path = str(Path(path).expanduser())
    roots = _roots()
    if path.startswith("/"):
        matches = _from_absolute(Path(path).resolve(), line, roots)
    else:
        matches = _from_relative(path, current, line, roots)
    # リポそのもの(ファイルでない)を指したものは開けないので落とす
    return {"input": text, "matches": [m for m in matches if m["path"] not in ("", ".")]}
