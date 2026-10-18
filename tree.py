"""ファイルのタブ用。ある版のファイルを全部(差分の無いものも)と、作業中なら変更の印を返す。

作業中(wt:<名>)は ls-files で「追跡中 + 無視されていない新しいファイル」と、gitignore されたものを出す
(VS Code と同じく薄く出す。手元だけの調査資料を見たいため)。丸ごと無視されたフォルダ(node_modules など)は
1 行だけ返し、開いたときに dir() で中を読む(何万ファイルもの一覧を毎回送らないため)。
コミットの版は ls-tree で、その時点のファイルを出す。
"""
from pathlib import Path

import safe
import wipfiles
import worktree
from gitdata import _git

# 印は VS Code に合わせる。ステージ済みと未ステージの両方にあるファイルは M
_MARK = {"A": "A", "M": "M", "D": "D", "R": "R", "T": "M", "U": "U", "!": "!"}


def refs(repo: Path) -> dict:
    """選べる版: ワークツリー(作業中)・ローカルブランチ・タグ。ブランチとタグは SHA に引いて返す。"""
    wts = [{"name": w["name"], "branch": w.get("branch"), "main": w["main"]} for w in worktree.worktrees(repo)]
    r = _git(repo, "for-each-ref", "--sort=-committerdate", "--format=%(refname)%1f%(objectname)%1f%(*objectname)",
             "refs/heads", "refs/tags")
    branches, tags = [], []
    for line in r.stdout.splitlines():
        name, sha, peeled = line.split("\x1f")
        if name.startswith("refs/heads/"):
            branches.append({"name": name[11:], "sha": sha})
        else:  # 注釈付きタグはコミットを指す側(peeled)を使う
            tags.append({"name": name[10:], "sha": peeled or sha})
    return {"worktrees": wts, "branches": branches, "tags": tags[:50]}


def marks(wt: Path) -> dict[str, str]:
    f = wipfiles.files(wt)
    out = {x["path"]: "U" for x in f["untracked"]}
    for part in ("staged", "unstaged"):
        for x in f[part]:
            out.setdefault(x["path"], _MARK.get(x["status"], "M"))
    return out


def tree(repo: Path, ref: str) -> dict:
    if ref.startswith("wt:"):
        cwd = safe.worktree_path(repo, ref[3:])
        r = _git(cwd, "--no-optional-locks", "ls-files", "-z", "--cached", "--others", "--exclude-standard")
        if r.returncode != 0:
            raise RuntimeError(r.stderr.strip() or "git ls-files が失敗")
        files = sorted(set(filter(None, r.stdout.split("\0"))))
        ign = _git(cwd, "--no-optional-locks", "ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--directory")
        ignored = sorted(filter(None, ign.stdout.split("\0")))
        # 丸ごと無視されたフォルダの中のものは git が別の行でも返すことがある。外側の 1 行だけ残す
        dirs = [p for p in ignored if p.endswith("/")]
        top = [p for p in ignored if not any(p != d and p.startswith(d) for d in dirs)]
        # 消したファイルも ls-files には残る。印は D、中身は開けない
        return {"ref": ref, "files": files, "marks": marks(cwd),
                "ignored": [p for p in top if not p.endswith("/")],
                "ignoredDirs": [p.rstrip("/") for p in top if p.endswith("/")]}
    sha = safe.sha(ref)
    r = _git(repo, "ls-tree", "-r", "-z", "--name-only", sha)
    if r.returncode != 0:
        raise safe.NotFound(f"その版は無い: {ref}")
    return {"ref": ref, "files": sorted(filter(None, r.stdout.split("\0"))), "marks": {}}


_MAX_ENTRIES = 3000  # node_modules の 1 段目でもこのくらいに収まる。超えた分は切る


def dir_entries(repo: Path, ref: str, path: str) -> dict:
    """丸ごと無視されたフォルダを開いたときの中身(1 段だけ)。フォルダは末尾に / を付けない別の並びで返す。"""
    if not ref.startswith("wt:"):
        raise safe.Bad("フォルダの中を読むのは作業中の版だけ")
    real = safe.inside_dir(safe.worktree_path(repo, ref[3:]), path)
    files, dirs = [], []
    for e in sorted(real.iterdir(), key=lambda x: x.name)[:_MAX_ENTRIES]:
        if e.name == ".git":
            continue
        (dirs if e.is_dir() else files).append(f"{path}/{e.name}")
    return {"path": path, "files": files, "dirs": dirs, "truncated": len(list(real.iterdir())) > _MAX_ENTRIES}
