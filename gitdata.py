"""~/softdata/git のリポジトリを読む。一覧・グラフ用のログ・フェッチ。

サーバー(server.py)から呼ぶ。git は必ずサブプロセスで叩き、外から来た文字列を
パスや引数に直接入れない(リポ名は一覧の名前と照合してから使う)。
"""
import os
import re
import subprocess
import threading
import time
from pathlib import Path

ROOT = Path(os.environ.get("SRG_ROOT", Path.home() / "softdata" / "git"))
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


def _git(repo: Path, *args: str, timeout: float = 15) -> subprocess.CompletedProcess:
    env = dict(os.environ, GIT_TERMINAL_PROMPT="0", LC_ALL="C")
    return subprocess.run(["git", "-C", str(repo), *args], capture_output=True, text=True,
                          timeout=timeout, env=env)


def _origin(repo: Path) -> str | None:
    r = _git(repo, "remote", "get-url", "origin")
    return r.stdout.strip() if r.returncode == 0 else None


def list_repos(root: Path = ROOT, n: int = RECENT) -> list[dict]:
    """最近使ったリポ n 個。新しい順。"""
    found = []
    for d in root.iterdir():
        g = d / ".git"
        if g.is_dir():  # .git がファイルの worktree そのものは本体と重なるので数えない
            found.append((last_used(g), d))
    found.sort(key=lambda t: t[0], reverse=True)
    return [{"name": d.name, "lastUsed": int(t), "github": github_url(_origin(d))}
            for t, d in found[:n]]


def resolve(name: str, root: Path = ROOT) -> Path | None:
    """外から来たリポ名を、いまの一覧にある名前と完全一致したときだけパスにする。"""
    for r in list_repos(root):
        if r["name"] == name:
            return root / name
    return None


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
