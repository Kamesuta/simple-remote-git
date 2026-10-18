"""外から来た値を、git やファイルに渡してよい形か確かめる。

tailnet の中だけに出しているとはいえ、URL の文字列をそのままパスや git の引数にしない。
形が悪いものは Bad(400)、形は良いが無いものは NotFound(404)で断る。
"""
import re
from pathlib import Path

import worktree

_SHA = re.compile(r"^[0-9a-f]{4,40}$")
_STASH = re.compile(r"^stash@\{\d{1,4}\}$")


class Bad(ValueError):
    """形が悪い(400)。"""


class NotFound(LookupError):
    """形は良いが、そこに無い(404)。"""


def sha(v: str | None) -> str:
    if not v or not _SHA.match(v):
        raise Bad(f"コミットの SHA の形でない: {v}")
    return v


def stash(v: str | None) -> str:
    if not v or not _STASH.match(v):
        raise Bad(f"スタッシュの名前の形でない: {v}")
    return v


def rel_path(v: str | None) -> str:
    """リポの根からの相対パス。`..`・空の段・`-` 始まりを断る(git の引数やリポの外への抜け道になるため)。"""
    if not v or v.startswith(("/", "-")) or "\0" in v:
        raise Bad(f"リポの中の相対パスでない: {v}")
    if any(part in ("", ".", "..") for part in v.split("/")):
        raise Bad(f"パスに ../ や空の段がある: {v}")
    return v


def worktree_path(repo: Path, name: str | None) -> Path:
    """ワークツリーの名前を、git worktree list に今あるものと照合してパスにする。"""
    for w in worktree.worktrees(repo):
        if w["name"] == name:
            return Path(w["path"])
    raise NotFound(f"そのワークツリーは無い: {name}")


def readable(wt: Path, rel: str) -> Path:
    """作業中のファイルをディスクから読んでよいか。ワークツリーの外(リンクで抜ける場合も)は出さない。
    gitignore されたものも出す(手元だけの調査資料などを見たいため。tailnet の中だけなのでそれでよいと本人が決めた)。"""
    rel = rel_path(rel)
    root = wt.resolve()
    real = (wt / rel).resolve()
    if root not in real.parents:
        raise Bad(f"ワークツリーの外を指している: {rel}")
    if not real.is_file():
        raise NotFound(f"ファイルが無い: {rel}")
    return real


def inside_dir(wt: Path, rel: str) -> Path:
    """作業中のフォルダを一覧してよいか(無視されたフォルダを開いたときに中を読むため)。外へは出さない。"""
    rel = rel_path(rel)
    root = wt.resolve()
    real = (wt / rel).resolve()
    if root not in real.parents:
        raise Bad(f"ワークツリーの外を指している: {rel}")
    if not real.is_dir():
        raise NotFound(f"フォルダが無い: {rel}")
    return real
