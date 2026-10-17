"""コミットとスタッシュの詳細(件名・本文・親・変わったファイルの一覧)。

ファイルの一覧は --name-status と --numstat を別々に取り、新しい側のパスで突き合わせる
(1 本で両方を出す書式は無いため)。どちらも -z で受け、日本語のファイル名を引用符で包ませない。
マージは第 1 親と比べる(GitHub のコミットページと同じ見え方にするため)。
"""
from pathlib import Path

import safe
from gitdata import _git, _origin, github_url, parse_refs

EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"  # 根のコミットや untracked を「空から」比べる相手
_META = "%H%x1f%P%x1f%an%x1f%at%x1f%D%x1f%s%x1f%b"


def parse_name_status(z: str) -> list[dict]:
    """`--name-status -z`: `M\\0path\\0` / `R100\\0old\\0new\\0`。"""
    parts, out, i = z.split("\0"), [], 0
    while i < len(parts) - 1:
        st = parts[i]
        if not st:
            break
        if st[0] in "RC":
            out.append({"status": st[0], "old": parts[i + 1], "path": parts[i + 2]})
            i += 3
        else:
            out.append({"status": st[0], "path": parts[i + 1]})
            i += 2
    return out


def parse_numstat(z: str) -> dict[str, tuple]:
    """`--numstat -z`: `add\\tdel\\tpath\\0`、名前変更は `add\\tdel\\t\\0old\\0new\\0`。バイナリは `-\\t-`。"""
    parts, out, i = z.split("\0"), {}, 0
    while i < len(parts) - 1:
        head = parts[i]
        if not head:
            break
        add, dele, path = head.split("\t", 2)
        if path == "":
            path = parts[i + 2]
            i += 3
        else:
            i += 1
        out[path] = (None, None) if add == "-" else (int(add), int(dele))
    return out


def merge_files(ns: str, num: str) -> list[dict]:
    stats = parse_numstat(num)
    files = parse_name_status(ns)
    for f in files:
        add, dele = stats.get(f["path"], (0, 0))
        f.update({"add": add, "del": dele, "binary": add is None})
    return files


def file_list(repo: Path, base: str, h: str) -> list[dict]:
    args = ["-M", "-z", base, h, "--"]
    return merge_files(_git(repo, "diff", "--name-status", *args).stdout,
                       _git(repo, "diff", "--numstat", *args).stdout)


def _meta(repo: Path, rev: str) -> dict:
    r = _git(repo, "show", "-s", f"--format={_META}", rev, "--")
    if r.returncode != 0:
        raise safe.NotFound(f"そのコミットは無い: {rev}")
    h, p, an, at, deco, s, body = r.stdout.rstrip("\n").split("\x1f", 6)
    # リンクから直接開くとグラフがまだ無いので、チップの元(%D)もここで返す
    remotes = set(_git(repo, "remote").stdout.split())
    return {"h": h, "p": p.split(), "an": an, "at": int(at), "refs": parse_refs(deco, remotes), "s": s, "body": body.strip()}


def pushed(repo: Path, h: str) -> bool:
    """どれかの remote のブランチに含まれているか(含まれていなければ GitHub にまだ無い)。"""
    r = _git(repo, "for-each-ref", "--contains", h, "--count=1", "--format=x", "refs/remotes")
    return r.returncode == 0 and bool(r.stdout.strip())


def commit(repo: Path, h: str) -> dict:
    m = _meta(repo, safe.sha(h))
    m["files"] = file_list(repo, m["p"][0] if m["p"] else EMPTY_TREE, m["h"])
    m["pushed"] = pushed(repo, m["h"])
    m["github"] = github_url(_origin(repo))
    return m


def stash(repo: Path, name: str) -> dict:
    """スタッシュは親が [元のコミット, index, (untracked)]。作業ツリーの差分に、untracked の分を新規として足す。"""
    m = _meta(repo, safe.stash(name))
    m["name"] = name
    m["files"] = file_list(repo, m["p"][0], m["h"])
    if len(m["p"]) > 2:
        m["files"] += [dict(f, untracked=True) for f in file_list(repo, EMPTY_TREE, m["p"][2])]
    return m


def log(repo: Path, ref: str, path: str, n: int = 1) -> list[dict]:
    """そのファイルを変えたコミット(新しい順)。ref は SHA か `wt:<名>`(そのワークツリーの HEAD から)。"""
    path = safe.rel_path(path)
    if ref.startswith("wt:"):
        cwd, rev = safe.worktree_path(repo, ref[3:]), "HEAD"
    else:
        cwd, rev = repo, safe.sha(ref)
    r = _git(cwd, "log", f"-n{max(1, min(200, n))}", "--format=%H%x1f%an%x1f%at%x1f%s", rev, "--", path)
    out = []
    for line in r.stdout.splitlines():
        h, an, at, s = line.split("\x1f", 3)
        out.append({"h": h, "an": an, "at": int(at), "s": s})
    return out
