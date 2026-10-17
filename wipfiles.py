"""ワークツリーごとの未コミットのファイル(変更のタブ用)。ステージ済み・未ステージ・新しいファイルに分ける。

status も diff も --no-optional-locks で叩く(見ただけで index を書き換えると、
「最近使った」の順位が動いてしまうため。worktree.wip_counts と同じ理由)。
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import worktree
from gitdata import _git
from gitshow import parse_numstat

_MAX_COUNT = 1_000_000  # 新しいファイルの行数を数えるのはこの大きさまで(大きいものは数えない)


def parse_status_v2(z: str) -> dict[str, list]:
    """`status --porcelain=v2 -z` を読む。1 行が両方(ステージ済みと未ステージ)に出ることもある。"""
    out = {"staged": [], "unstaged": [], "untracked": []}
    recs, i = z.split("\0"), 0
    while i < len(recs):
        rec = recs[i]
        i += 1
        if not rec:
            continue
        kind = rec[0]
        if kind == "?":
            out["untracked"].append({"status": "U", "path": rec[2:]})
        elif kind in "12":
            f = rec.split(" ", 9 if kind == "2" else 8)
            xy, path = f[1], f[-1]
            old = None
            if kind == "2":  # 名前変更は次の欄に元の名前が来る
                old, i = recs[i], i + 1
            if xy[0] != ".":
                out["staged"].append({"status": xy[0], "path": path, **({"old": old} if old else {})})
            if xy[1] != ".":
                out["unstaged"].append({"status": xy[1], "path": path})
        elif kind == "u":  # 衝突中。直すのは手元なので、未ステージに「!」で出すだけ
            out["unstaged"].append({"status": "!", "path": rec.split(" ", 10)[-1]})
    return out


def _count_lines(p: Path) -> int | None:
    try:
        if p.stat().st_size > _MAX_COUNT:
            return None
        data = p.read_bytes()
    except OSError:
        return None
    return None if b"\0" in data[:8000] else data.count(b"\n") + (0 if data.endswith(b"\n") or not data else 1)


def files(wt: Path) -> dict[str, list]:
    st = _git(wt, "--no-optional-locks", "status", "--porcelain=v2", "-z", "--untracked-files=all")
    if st.returncode != 0:
        return {"staged": [], "unstaged": [], "untracked": [], "error": st.stderr.strip()}
    out = parse_status_v2(st.stdout)
    for part, args in (("staged", ["--cached", "-M"]), ("unstaged", [])):
        nums = parse_numstat(_git(wt, "--no-optional-locks", "diff", *args, "--numstat", "-z").stdout)
        for f in out[part]:
            f["add"], f["del"] = nums.get(f["path"], (0, 0))
    for f in out["untracked"]:
        f["add"], f["del"] = _count_lines(wt / f["path"]), 0
    return out


def changes(repo: Path) -> list[dict]:
    """全ワークツリーの未コミット。my-app は 15 個あるので並べて取る。"""
    wts = worktree.worktrees(repo)
    with ThreadPoolExecutor(max_workers=8) as ex:
        res = list(ex.map(lambda w: files(Path(w["path"])), wts))
    home = str(Path.home())
    out = []
    for w, f in zip(wts, res):
        p = Path(w["path"])
        shown = p.relative_to(repo).as_posix() if p.is_relative_to(repo) and p != repo else w["path"].replace(home, "~", 1)
        out.append({"name": w["name"], "main": w["main"], "branch": w.get("branch"), "head": w.get("head"),
                    "path": shown, **f})
    return out
