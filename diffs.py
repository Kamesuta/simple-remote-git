"""1 ファイルの差分と、ファイルの中身。

差分は unified の生の文字列で返し、分解は画面(lib/unidiff.js)に任せる。
スマホが固まらないよう、差分は 5,000 行・中身は 1 MB で打ち切って truncated を立てる。
"""
from pathlib import Path

import safe
from gitdata import _git
from gitshow import EMPTY_TREE

MAX_LINES = 5000
MAX_BYTES = 1_000_000
IMAGES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
          ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon"}


def cap(text: str) -> dict:
    lines = text.split("\n")
    over = len(lines) > MAX_LINES
    return {"text": "\n".join(lines[:MAX_LINES]) if over else text, "truncated": over,
            "binary": text.startswith("Binary files ") or "\nBinary files " in text[:2000]}


def _diff(cwd: Path, *args: str) -> dict:
    # --no-index は差があると 1 で終わるので、終わりのコードでなく出力で見る
    r = _git(cwd, "--no-optional-locks", "diff", "--no-color", "--no-ext-diff", *args)
    if r.returncode not in (0, 1):
        raise RuntimeError(r.stderr.strip() or "git diff が失敗")
    return cap(r.stdout)


def _paths(path: str, old: str | None) -> list[str]:
    # 名前変更は元の名前も渡す(片方だけだと、消して足したように見える)
    return ["--", *([safe.rel_path(old)] if old else []), safe.rel_path(path)]


def diff(repo: Path, src: str, path: str, *, h=None, name=None, wt=None, old=None) -> dict:
    if src == "commit":
        h = safe.sha(h)
        parents = _git(repo, "rev-parse", f"{h}^@").stdout.split()
        return _diff(repo, "-M", parents[0] if parents else EMPTY_TREE, h, *_paths(path, old))
    if src == "stash":
        name = safe.stash(name)
        out = _diff(repo, "-M", f"{name}^1", name, *_paths(path, old))
        if not out["text"] and _git(repo, "rev-parse", "-q", "--verify", f"{name}^3").returncode == 0:
            out = _diff(repo, EMPTY_TREE, f"{name}^3", *_paths(path, None))  # untracked の分
        return out
    cwd = safe.worktree_path(repo, wt)
    if src == "staged":
        return _diff(cwd, "--cached", "-M", *_paths(path, old))
    if src == "unstaged":
        return _diff(cwd, *_paths(path, None))
    if src == "untracked":
        safe.readable(cwd, path)
        return _diff(cwd, "--no-index", "--", "/dev/null", path)
    raise safe.Bad(f"src が分からない: {src}")


def _as_text_or_raw(data: bytes, path: str, sha: str | None):
    ext = Path(path).suffix.lower()
    if ext in IMAGES:
        return data, IMAGES[ext]
    if b"\0" in data[:8000]:
        return {"binary": True, "size": len(data), "sha": sha}, None
    over = len(data) > MAX_BYTES
    return {"text": data[:MAX_BYTES].decode("utf-8", "replace"), "truncated": over, "sha": sha}, None


def content(repo: Path, ref: str, path: str):
    """ref はコミットの SHA か `wt:<ワークツリー名>`(作業中のディスク)。
    返すのは (JSON にする dict, None) か (画像のバイト列, Content-Type)。"""
    path = safe.rel_path(path)
    if ref.startswith("wt:"):
        cwd = safe.worktree_path(repo, ref[3:])
        real = safe.readable(cwd, path)
        head = _git(cwd, "rev-parse", "HEAD").stdout.strip() or None
        with open(real, "rb") as f:
            return _as_text_or_raw(f.read(MAX_BYTES + 1), path, head)
    sha = safe.sha(ref)
    r = _git(repo, "show", f"{sha}:{path}", text=False)
    if r.returncode != 0:
        raise safe.NotFound(f"その版にそのファイルは無い: {path}")
    return _as_text_or_raw(r.stdout, path, sha)
