"""リポを並べた場所(ROOT)のリポジトリを読む。一覧・グラフ用のログ・フェッチ。

サーバー(server.py)から呼ぶ。git は必ずサブプロセスで叩き、外から来た文字列を
パスや引数に直接入れない(リポ名は一覧の名前と照合してから使う)。
"""
import os
import re
import subprocess
import threading
import time
from pathlib import Path

# 既定はこのアプリを置いたフォルダの親。リポを並べている場所に clone すれば、その隣のリポが並ぶ
ROOT = Path(os.environ.get("SRG_ROOT") or Path(__file__).resolve().parent.parent).expanduser()
RECENT = 6
FETCH_TIMEOUT = 30
# 開くたびに自動フェッチするので、続けて開いたときに同じリポを何度も叩かない
FETCH_SKIP_SEC = 20

# 自分が触ったときに動くファイル。FETCH_HEAD は入れない(自動フェッチで順位が動くため)
_USE_MARKS = ("index", "logs/HEAD", "worktrees/*/index", "worktrees/*/logs/HEAD")


def last_used(git_dir: Path) -> float:
    """そのリポを最後に触った時刻。worktree で作業していると本体の index は動かないので、そちらも見る。"""
    best = 0.0
    for pat in _USE_MARKS:
        for p in git_dir.glob(pat):
            try:
                best = max(best, p.stat().st_mtime)
            except OSError:
                pass
    return best


def github_url(remote: str | None) -> str | None:
    """origin の URL を https://github.com/<owner>/<repo> に直す。GitHub でなければ None。"""
    if not remote:
        return None
    m = re.match(r"^(?:https://(?:[^@/]+@)?github\.com/|git@github\.com:|ssh://git@github\.com/)"
                 r"([^/]+)/(.+?)(?:\.git)?/?$", remote.strip())
    return f"https://github.com/{m[1]}/{m[2]}" if m else None


def _git(repo: Path, *args: str, timeout: float = 15, text: bool = True) -> subprocess.CompletedProcess:
    """git を叩く。text=False はファイルの中身(画像など)をバイト列のまま受けたいとき。"""
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0", LC_ALL="C")
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=text,
                          encoding="utf-8" if text else None, errors="replace" if text else None,
                          timeout=timeout, env=env)


def _origin(repo: Path) -> str | None:
    r = _git(repo, "remote", "get-url", "origin")
    return r.stdout.strip() if r.returncode == 0 else None


def scan(root: Path | None = None) -> list[tuple[float, Path]]:
    """root の下のリポを (最後に触った時刻, パス) で、新しい順に。git は叩かない(毎回の照合で使うため)。
    root の既定は呼んだ時点の ROOT(テストで ROOT を差し替えられるように)。"""
    root = root or ROOT
    found = []
    for d in root.iterdir():
        # games のようにリポを束ねるだけのフォルダは、1 階層だけ潜る
        for c in [d] if (d / ".git").exists() else (d.iterdir() if d.is_dir() else []):
            if (c / ".git").is_dir():  # .git がファイルの worktree そのものは本体と重なるので数えない
                found.append((last_used(c / ".git"), c))
    return sorted(found, key=lambda t: t[0], reverse=True)


def root_label(root: Path | None = None) -> str:
    """画面に出す ROOT。ホームの下なら ~ で縮める(スマホの狭い帯に収めるため)。"""
    root = (root or ROOT).resolve()
    try:
        return "~/" + root.relative_to(Path.home().resolve()).as_posix()
    except ValueError:
        return root.as_posix()


def list_repos(root: Path | None = None, n: int = RECENT) -> list[dict]:
    """最近使ったリポ n 個。新しい順。"""
    root = root or ROOT
    # 潜ったものは「束ね/リポ」の名前になる。resolve は root / name のまま引ける
    return [{"name": d.relative_to(root).as_posix(), "lastUsed": int(t), "github": github_url(_origin(d))}
            for t, d in scan(root)[:n]]


def resolve(name: str, root: Path | None = None) -> Path | None:
    """外から来たリポ名を、root の下にあるリポの名前と完全一致したときだけパスにする。
    チップの 6 個に限らない(貼ったパスは古いリポを指すこともあるため)。"""
    root = root or ROOT
    for _, d in scan(root):
        if d.relative_to(root).as_posix() == name:
            return d
    return None


def fetched_at(repo: Path) -> int | None:
    """最後にフェッチできた時刻。FETCH_HEAD の mtime を使う(手で fetch した分も入る)。"""
    try:
        return int((repo / ".git" / "FETCH_HEAD").stat().st_mtime)
    except OSError:
        return None


_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def fetch(repo: Path) -> dict:
    """git fetch --all。同じリポは同時に 1 本だけ。直近に取ったばかりなら省く。"""
    with _locks_guard:
        lock = _locks.setdefault(str(repo), threading.Lock())
    with lock:  # 走っている最中に来た分は終わるのを待ち、下の「最近取った」で省かれる
        last = fetched_at(repo)
        if last and time.time() - last < FETCH_SKIP_SEC:
            return {"ok": True, "skipped": True, "fetchedAt": last}
        try:
            r = _git(repo, "fetch", "--all", "--prune", "--tags", timeout=FETCH_TIMEOUT)
        except subprocess.TimeoutExpired:
            return {"ok": False, "error": f"{FETCH_TIMEOUT} 秒で終わらなかった", "fetchedAt": last}
        if r.returncode != 0:
            err = (r.stderr.strip().splitlines() or ["git fetch が失敗"])[-1]
            return {"ok": False, "error": err, "fetchedAt": last}
        return {"ok": True, "skipped": False, "fetchedAt": fetched_at(repo)}
