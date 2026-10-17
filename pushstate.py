"""プッシュしたかどうか。グラフの各コミットに pushed、ローカルブランチの ref に ahead / behind を付ける。

「どの remote にも無いコミット」を未プッシュとみなす(origin 以外に押した分もプッシュ済みに数える)。
remote が 1 つも無いリポは、全部が未プッシュになってしまい印の意味が無いので付けない。
"""
import re
from pathlib import Path

from gitdata import _git

# グラフは 400 件ほど。未プッシュがそれを超えることはまず無いので、上限で打ち切って重くしない
_LIMIT = 2000
_TRACK = re.compile(r"(ahead|behind) (\d+)")


def unpushed(repo: Path) -> set[str]:
    r = _git(repo, "rev-list", "--exclude=refs/stash", "--all", "--not", "--remotes", f"-n{_LIMIT}")
    return set(r.stdout.split()) if r.returncode == 0 else set()


def parse_track(text: str) -> dict[str, dict]:
    """`for-each-ref --format=%(refname:short)%1f%(upstream:track,nobracket)` を読む。
    `ahead 2, behind 1` / `ahead 3` / `gone` / 空(追っていない)のどれか。"""
    out = {}
    for line in text.splitlines():
        name, _, track = line.partition("\x1f")
        n = {k: int(v) for k, v in _TRACK.findall(track)}
        if n:
            out[name] = {"ahead": n.get("ahead", 0), "behind": n.get("behind", 0)}
        elif track == "gone":
            out[name] = {"gone": True}
    return out


def tracking(repo: Path) -> dict[str, dict]:
    r = _git(repo, "for-each-ref", "--format=%(refname:short)%1f%(upstream:track,nobracket)", "refs/heads")
    return parse_track(r.stdout) if r.returncode == 0 else {}


def mark(repo: Path, data: dict) -> dict:
    """graphlog.graph() の結果に印を付ける。remote の無いリポは何もしない。"""
    if not data.get("remotes"):
        return data
    unp, track = unpushed(repo), tracking(repo)
    for c in data["commits"]:
        if c.get("kind", "commit") != "commit":
            continue
        c["pushed"] = c["h"] not in unp
        for ref in c["refs"]:
            if ref["t"] in ("local", "head") and ref["n"] in track:
                ref.update(track[ref["n"]])
    return data
