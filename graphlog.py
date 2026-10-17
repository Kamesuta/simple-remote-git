"""グラフ用のログ(git log --all --topo-order)を読み、ref を種類付きに分ける。

ワークツリーの印・未コミット・スタッシュは worktree.decorate、未プッシュの印は pushstate.mark が後から足す。
"""
from pathlib import Path

from gitdata import _git, _origin, fetched_at, github_url


def parse_refs(deco: str, remotes: set[str]) -> list[dict]:
    """%D(`HEAD -> dev, origin/dev, tag: v1`)を種類付きに分ける。
    remote 名を知らないと `feature/x`(ローカル)と `origin/x` を分けられないので受け取る。"""
    out = []
    for part in filter(None, (s.strip() for s in deco.split(","))):
        if part.startswith("HEAD -> "):
            out.append({"t": "head", "n": part[8:]})
        elif part == "HEAD":
            out.append({"t": "head", "n": "HEAD"})
        elif part.startswith("tag: "):
            out.append({"t": "tag", "n": part[5:]})
        elif "/" in part and part.split("/", 1)[0] in remotes:
            out.append({"t": "remote", "n": part})
        else:
            out.append({"t": "local", "n": part})
    return out

LOG_FORMAT = "%H%x1f%P%x1f%D%x1f%an%x1f%at%x1f%s%x1e"


def parse_log(text: str, remotes: set[str] = frozenset({"origin"})) -> list[dict]:
    commits = []
    for rec in text.split("\x1e"):
        rec = rec.strip("\n")
        if not rec:
            continue
        h, p, d, an, at, s = rec.split("\x1f", 5)
        commits.append({"kind": "commit", "h": h, "p": p.split() if p else [], "refs": parse_refs(d, remotes),
                        "an": an, "at": int(at), "s": s})
    return commits


def graph(repo: Path, limit: int = 400) -> dict:
    rs = _git(repo, "remote")
    remotes = set(rs.stdout.split()) if rs.returncode == 0 else set()
    r = _git(repo, "log", "--exclude=refs/stash", "--all", "--topo-order", f"-n{int(limit)}",
             f"--format={LOG_FORMAT}")
    if r.returncode != 0:
        raise RuntimeError(r.stderr.strip() or "git log が失敗")
    # remotes が空なら画面は「フェッチ先なし」と出す(origin の無いリポもある)
    return {"commits": parse_log(r.stdout, remotes), "github": github_url(_origin(repo)),
            "remotes": sorted(remotes), "fetchedAt": fetched_at(repo)}
