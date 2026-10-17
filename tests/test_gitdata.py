"""gitdata / worktree を、一時フォルダに作った本物の git リポで確かめる。"""
import time
import unittest
from pathlib import Path

from helpers import TmpCase, git, make_repo, touch
import gitdata  # noqa: E402
import graphlog  # noqa: E402
import worktree  # noqa: E402



class ListRepos(TmpCase):
    def test_order_by_last_use_and_worktree_counts(self):
        old, mid = make_repo(self.root, "old"), make_repo(self.root, "mid")
        (self.root / "not-a-repo").mkdir()
        base = time.time() - 10000
        for d, t in ((old, base), (mid, base + 100)):
            for f in ("index", "logs/HEAD"):
                touch(d / ".git" / f, t)
        self.assertEqual([r["name"] for r in gitdata.list_repos(self.root)], ["mid", "old"])
        # old を worktree で触ると、本体の index が古くても上に来る
        git(old, "worktree", "add", "-q", str(self.root / "wt"), "-b", "side")
        touch(old / ".git" / "index", base)
        self.assertEqual(gitdata.list_repos(self.root)[0]["name"], "old")
        # FETCH_HEAD では動かない(自動フェッチで順位が変わらないように)
        for p in (old / ".git").rglob("*"):
            if p.is_file():
                touch(p, base)
        (mid / ".git" / "FETCH_HEAD").write_text("")
        (old / ".git" / "FETCH_HEAD").write_text("")
        touch(old / ".git" / "FETCH_HEAD", time.time() + 100)
        self.assertEqual(gitdata.list_repos(self.root)[0]["name"], "mid")

    def test_dive_one_level_into_plain_folders(self):
        make_repo(self.root, "top")
        make_repo(self.root, "bundle/inner")
        make_repo(self.root, "top/sub")  # リポの中のリポは潜らない
        make_repo(self.root, "a/b/deep")  # 2 階層下は探さない
        names = {r["name"] for r in gitdata.list_repos(self.root)}
        self.assertEqual(names, {"top", "bundle/inner"})
        self.assertEqual(gitdata.resolve("bundle/inner", self.root), self.root / "bundle" / "inner")

    def test_resolve_only_listed_names(self):
        make_repo(self.root, "ok")
        self.assertEqual(gitdata.resolve("ok", self.root), self.root / "ok")
        for bad in ("../ok", "ok/", "", "/etc", "nope"):
            self.assertIsNone(gitdata.resolve(bad, self.root), bad)


class Parse(unittest.TestCase):
    def test_github_url(self):
        f = gitdata.github_url
        self.assertEqual(f("https://github.com/octocat/hello-world.git"), "https://github.com/octocat/hello-world")
        self.assertEqual(f("git@github.com:Kamesuta/hakari-sheet.git"), "https://github.com/Kamesuta/hakari-sheet")
        self.assertEqual(f("https://x-token@github.com/a/b"), "https://github.com/a/b")
        self.assertIsNone(f("https://gitlab.com/a/b.git"))
        self.assertIsNone(f(None))

    def test_parse_refs(self):
        refs = graphlog.parse_refs("HEAD -> dev, origin/dev, feature/x, tag: v1, origin/HEAD", {"origin"})
        self.assertEqual([(r["t"], r["n"]) for r in refs], [
            ("head", "dev"), ("remote", "origin/dev"), ("local", "feature/x"), ("tag", "v1"), ("remote", "origin/HEAD")])

    def test_parse_stashes(self):
        st = worktree.parse_stashes("stash@{0}\x1fa b\x1f10\x1fOn dev: handoff\n"
                                    "stash@{1}\x1fc d e\x1f9\x1fWIP on main: 1234567 件名: あり\n")
        self.assertEqual([(s["name"], s["p"], s["on"], s["s"]) for s in st],
                         [("stash@{0}", ["a"], "dev", "handoff"), ("stash@{1}", ["c"], "main", "件名: あり")])


class Decorate(TmpCase):
    def setUp(self):
        super().setUp()
        self.repo = make_repo(self.root, "r")
        (self.repo / "a.txt").write_text("2")
        git(self.repo, "commit", "-qam", "second")

    def graph(self):
        return worktree.decorate(self.repo, graphlog.graph(self.repo))["commits"]

    def test_worktree_marks_and_wip_above_head(self):
        first = git(self.repo, "rev-parse", "HEAD~1")
        git(self.repo, "worktree", "add", "-q", str(self.root / "wt-side"), "-b", "side", first)
        git(self.repo, "worktree", "add", "-q", "--detach", str(self.root / "wt-det"), first)
        (self.root / "wt-side" / "a.txt").write_text("changed")
        (self.root / "wt-side" / "new.txt").write_text("new")
        (self.repo / "a.txt").write_text("main changed")
        git(self.repo, "add", "a.txt")
        index_mtime = (self.repo / ".git" / "index").stat().st_mtime_ns

        cs = self.graph()
        kinds = [c["kind"] for c in cs]
        self.assertEqual(kinds, ["wip", "commit", "wip", "commit"])
        main_wip, side_wip = cs[0], cs[2]
        self.assertEqual((main_wip["wt"], main_wip["main"], main_wip["staged"]), ("作業ツリー", True, 1))
        self.assertEqual((side_wip["wt"], side_wip["modified"], side_wip["untracked"]), ("wt-side", 1, 1))
        self.assertEqual(side_wip["p"], [first])
        refs = cs[3]["refs"]
        self.assertIn({"t": "local", "n": "side", "wt": True}, refs)
        self.assertIn({"t": "wt", "n": "wt-det", "wt": True}, refs)
        self.assertTrue(cs[1]["refs"][0]["wt"])  # 本体の HEAD -> main
        # 見ただけで index が書き換わらない(最近使った順が動かない)
        self.assertEqual((self.repo / ".git" / "index").stat().st_mtime_ns, index_mtime)

    def test_stash_above_its_base(self):
        (self.repo / "a.txt").write_text("wip")
        git(self.repo, "stash", "push", "-qm", "途中")
        (self.repo / "a.txt").write_text("3")
        git(self.repo, "commit", "-qam", "third")
        cs = self.graph()
        self.assertEqual([c["kind"] for c in cs], ["commit", "stash", "commit", "commit"])
        self.assertEqual((cs[1]["name"], cs[1]["on"], cs[1]["s"]), ("stash@{0}", "main", "途中"))
        self.assertEqual(cs[1]["p"], [cs[2]["h"]])

    def test_extras_outside_range_go_by_time(self):
        cs = [{"h": "c", "at": 30}, {"h": "b", "at": 20}, {"h": "a", "at": 10}]
        out = worktree.insert_extras(cs, [{"h": "s", "p": ["zzz"], "at": 25}])
        self.assertEqual([c["h"] for c in out], ["c", "s", "b", "a"])


if __name__ == "__main__":
    unittest.main()
