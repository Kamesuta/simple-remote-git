"""ワークツリー・未コミットの変更・スタッシュを読み、グラフのコミット列に差し込む。

Git Graph のように全部見せたうえで、ワークツリーを目立たせるのがこのツールの売り。
差し込む行は kind で見分ける(commit / wip / stash)。どれも親のコミットの真上に置くので、
graph.js は「親までの点線」を描くだけで済む。
"""
import re
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from gitdata import _git

_NO_HEAD = "0" * 40  # まだコミットの無い worktree


def parse_worktrees(text: str) -> list[dict]:
    """`git worktree list --porcelain` を読む。フォルダが消えたもの(prunable)と bare は飛ばす。"""
    out, cur = [], {}
    for line in text.splitlines() + [""]:
        if not line:
            if cur.get("path") and not cur.get("prunable") and not cur.get("bare"):
                out.append(cur)
            cur = {}
            continue
        key, _, val = line.partition(" ")
        if key == "worktree":
            cur = {"path": val}
        elif key == "HEAD" and val != _NO_HEAD:
            cur["head"] = val
        elif key == "branch":
            cur["branch"] = val.removeprefix("refs/heads/")
        elif key in ("detached", "prunable", "bare"):
            cur[key] = True
    for i, w in enumerate(out):  # 先頭が本体の作業ツリー
        w["main"] = i == 0
        w["name"] = "作業ツリー" if i == 0 else Path(w["path"]).name
    return out


def worktrees(repo: Path) -> list[dict]:
    r = _git(repo, "worktree", "list", "--porcelain")
    return parse_worktrees(r.stdout) if r.returncode == 0 else []


def tips(repo: Path) -> list[str]:
    """グラフと未プッシュの根: ブランチ・タグ・リモートと、各ワークツリーの HEAD(切り離した HEAD も)。
    --all は使わない。refs/archive に退避したブランチや filter-branch の refs/original まで載ってしまうため。
    HEAD という名前でなく SHA で渡すのは、コミットの無いリポで git log が失敗しないようにするため。"""
    return ["--branches", "--tags", "--remotes", *(w["head"] for w in worktrees(repo) if w.get("head"))]


def wip_counts(path: str) -> dict | None:
    """未コミットの数。--no-optional-locks で index を書き換えない
    (書き換えると index の mtime が動き、見ただけで「最近使った」の順位が上がってしまう)。"""
    r = _git(Path(path), "--no-optional-locks", "status", "--porcelain=v1")
    if r.returncode != 0:
        return None
    n = {"staged": 0, "modified": 0, "untracked": 0}
    for line in r.stdout.splitlines():
        x, y = line[0], line[1]
        if x == "?":
            n["untracked"] += 1
            continue
        if x not in " !":
            n["staged"] += 1
        if y not in " !":
            n["modified"] += 1
    return n


def parse_stashes(text: str) -> list[dict]:
    """`git stash list --format=%gd%x1f%P%x1f%at%x1f%gs` を読む。%gs は `On dev: msg` か `WIP on dev: abc1234 件名`。"""
    out = []
    for line in text.splitlines():
        if not line:
            continue
        name, parents, at, gs = line.split("\x1f", 3)
        m = re.match(r"^(?:WIP on|On) ([^:]+): (?:[0-9a-f]{7,40} )?(.*)$", gs)
        on, s = (m[1], m[2]) if m else ("", gs)
        out.append({"name": name, "p": parents.split()[:1], "at": int(at), "on": on, "s": s})
    return out


def stashes(repo: Path) -> list[dict]:
    r = _git(repo, "stash", "list", "--format=%gd%x1f%P%x1f%at%x1f%gs")
    return parse_stashes(r.stdout) if r.returncode == 0 else []


def mark_worktrees(commits: list[dict], wts: list[dict]) -> None:
    """worktree が開いているコミットの refs に印を付ける。本体の HEAD は %D の `HEAD -> x` に付ける。"""
    by_h = {c["h"]: c for c in commits}
    for w in wts:
        c = by_h.get(w.get("head"))
        if c is None:
            continue
        if w["main"]:
            for ref in c["refs"]:
                if ref["t"] == "head":
                    ref["wt"] = True
        elif w.get("branch"):
            for ref in c["refs"]:
                if ref["t"] == "local" and ref["n"] == w["branch"]:
                    ref["wt"] = True
        else:  # detached はブランチ名が無いのでフォルダ名で出す
            c["refs"].append({"t": "wt", "n": w["name"], "wt": True})


def insert_extras(commits: list[dict], extras: list[dict]) -> list[dict]:
    """差し込む行を親の真上に置く。親が範囲外なら、時刻の順で収まる位置に置く(線は下へ抜ける)。"""
    pos = {c["h"]: i for i, c in enumerate(commits)}
    before: dict[int, list] = {}
    for e in extras:
        i = pos.get(e["p"][0]) if e["p"] else None
        if i is None:
            i = next((k for k, c in enumerate(commits) if c["at"] < e["at"]), len(commits))
        before.setdefault(i, []).append(e)
    out = []
    for i, c in enumerate(commits):
        out += before.get(i, [])
        out.append(c)
    return out + before.get(len(commits), [])


def decorate(repo: Path, data: dict) -> dict:
    """graphlog.graph() の結果にワークツリーの印・未コミット・スタッシュを足す。"""
    wts = worktrees(repo)
    mark_worktrees(data["commits"], wts)
    with ThreadPoolExecutor(max_workers=8) as ex:  # my-app は worktree が 15 あるので並べる
        counts = list(ex.map(lambda w: wip_counts(w["path"]), wts))
    now = int(time.time())
    extras = [
        {"kind": "wip", "h": f"wip:{i}", "p": [w["head"]], "at": now, "wt": w["name"], "main": w["main"], **n}
        for i, (w, n) in enumerate(zip(wts, counts)) if n and any(n.values()) and w.get("head")
    ]
    extras += [{"kind": "stash", "h": st["name"], **st} for st in stashes(repo)]
    data["commits"] = insert_extras(data["commits"], extras)
    return data
