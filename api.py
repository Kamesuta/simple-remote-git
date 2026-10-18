"""/api/* の振り分け。server.py は HTTP の受け口だけにして、ここで引数を検査して各モジュールを呼ぶ。

どの API も repo を受け、gitdata.resolve で ~/softdata/git の下のリポと照合してから使う。
返すのは (状態コード, 本体)。本体が Raw ならそのままのバイト列、それ以外は JSON にする。
"""
import subprocess
from dataclasses import dataclass

import diffs
import gitdata
import gitshow
import graphlog
import pathres
import pushstate
import safe
import tree
import wipfiles
import worktree


@dataclass
class Raw:
    data: bytes
    ctype: str


def one(q: dict, key: str, default: str | None = None) -> str | None:
    return (q.get(key) or [default])[0]


def repo_of(q: dict):
    name = one(q, "repo", "")
    path = gitdata.resolve(name)
    if path is None:
        raise safe.NotFound(f"そのリポは ~/softdata/git に無い: {name}")
    return path


def repos(q):
    return gitdata.list_repos()


def graph(q):
    repo = repo_of(q)
    try:
        limit = max(1, min(2000, int(one(q, "limit", "400"))))
    except ValueError:
        raise safe.Bad("limit は数で")
    return worktree.decorate(repo, pushstate.mark(repo, graphlog.graph(repo, limit)))


def fetch(q):
    res = gitdata.fetch(repo_of(q))
    return res if res["ok"] else (502, res)


def commit(q):
    return gitshow.commit(repo_of(q), one(q, "h"))


def stash(q):
    return gitshow.stash(repo_of(q), one(q, "name"))


def changes(q):
    return wipfiles.changes(repo_of(q))


def diff(q):
    return diffs.diff(repo_of(q), one(q, "src", ""), one(q, "path"), h=one(q, "h"), name=one(q, "name"),
                      wt=one(q, "wt"), old=one(q, "old"))


def log(q):
    try:
        n = int(one(q, "n", "1"))
    except ValueError:
        raise safe.Bad("n は数で")
    return gitshow.log(repo_of(q), one(q, "ref", ""), one(q, "path"), n)


def resolve(q):
    return pathres.resolve(one(q, "path", ""), one(q, "repo"))


def files(q):
    return tree.tree(repo_of(q), one(q, "ref", "wt:作業ツリー"))


def dir_(q):
    return tree.dir_entries(repo_of(q), one(q, "ref", "wt:作業ツリー"), one(q, "path"))


def refs(q):
    return tree.refs(repo_of(q))


def file(q):
    body, ctype = diffs.content(repo_of(q), one(q, "ref", ""), one(q, "path"))
    return Raw(body, ctype) if ctype else body


GET = {"/api/repos": repos, "/api/graph": graph, "/api/commit": commit, "/api/stash": stash,
       "/api/changes": changes, "/api/diff": diff, "/api/file": file, "/api/log": log,
       "/api/resolve": resolve, "/api/tree": files, "/api/refs": refs,
       "/api/dir": dir_}
POST = {"/api/fetch": fetch}


def handle(method: str, path: str, q: dict) -> tuple[int, object]:
    fn = (GET if method == "GET" else POST).get(path)
    if fn is None:
        return 404, {"error": "無い API"}
    try:
        out = fn(q)
    except safe.Bad as e:
        return 400, {"error": str(e)}
    except safe.NotFound as e:
        return 404, {"error": str(e)}
    except subprocess.TimeoutExpired:
        return 504, {"error": "git が時間内に終わらなかった"}
    except RuntimeError as e:
        return 500, {"error": str(e)}
    # 状態コードを変えたいもの(フェッチ失敗の 502 など)は (コード, 本体) を返す
    return out if isinstance(out, tuple) else (200, out)
