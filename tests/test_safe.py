"""外から来た値の検査(safe)と、API の振り分け(api)の断り方を確かめる。"""
import os
import unittest
from unittest import mock

from helpers import TmpCase, git, make_repo
import api  # noqa: E402
import gitdata  # noqa: E402
import safe  # noqa: E402


class Shapes(unittest.TestCase):
    def test_sha_and_stash(self):
        self.assertEqual(safe.sha("a1b2c3d"), "a1b2c3d")
        self.assertEqual(safe.stash("stash@{2}"), "stash@{2}")
        for bad in ("", None, "HEAD", "-n1", "a1b2c3d;rm", "G123456"):
            with self.assertRaises(safe.Bad, msg=bad):
                safe.sha(bad)
        for bad in ("stash", "stash@{-1}", "stash@{0}x"):
            with self.assertRaises(safe.Bad, msg=bad):
                safe.stash(bad)

    def test_rel_path(self):
        self.assertEqual(safe.rel_path("web/app.js"), "web/app.js")
        for bad in ("", "/etc/passwd", "-x", "../a", "a/../b", "a//b", "a/", "./a"):
            with self.assertRaises(safe.Bad, msg=bad):
                safe.rel_path(bad)


class Readable(TmpCase):
    def setUp(self):
        super().setUp()
        self.repo = make_repo(self.root, "r")

    def test_reads_tracked_and_untracked(self):
        (self.repo / "new.txt").write_text("x")
        self.assertEqual(safe.readable(self.repo, "a.txt"), self.repo / "a.txt")
        self.assertEqual(safe.readable(self.repo, "new.txt"), self.repo / "new.txt")

    def test_reads_ignored_but_refuses_missing_and_escape(self):
        (self.repo / ".gitignore").write_text(".env\n")
        (self.repo / ".env").write_text("SECRET=1")
        self.assertEqual(safe.readable(self.repo, ".env"), self.repo / ".env")  # 無視されたものも読む(本人の判断)
        with self.assertRaises(safe.NotFound):
            safe.readable(self.repo, "nope.txt")
        (self.root / "outside.txt").write_text("x")
        os.symlink(self.root / "outside.txt", self.repo / "link.txt")
        with self.assertRaises(safe.Bad):
            safe.readable(self.repo, "link.txt")

    def test_worktree_path(self):
        git(self.repo, "worktree", "add", "-q", str(self.root / "wt-a"), "-b", "a")
        self.assertEqual(safe.worktree_path(self.repo, "wt-a").resolve(), (self.root / "wt-a").resolve())
        self.assertEqual(safe.worktree_path(self.repo, "作業ツリー").resolve(), self.repo.resolve())
        with self.assertRaises(safe.NotFound):
            safe.worktree_path(self.repo, "../r")


class Handle(TmpCase):
    def setUp(self):
        super().setUp()
        make_repo(self.root, "r")
        patcher = mock.patch.object(gitdata, "ROOT", self.root)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_codes(self):
        code, body = api.handle("GET", "/api/graph", {"repo": ["r"]})
        self.assertEqual(code, 200)
        self.assertEqual(len(body["commits"]), 1)
        self.assertEqual(api.handle("GET", "/api/graph", {"repo": ["nope"]})[0], 404)
        self.assertEqual(api.handle("GET", "/api/graph", {"repo": ["../r"]})[0], 404)
        self.assertEqual(api.handle("GET", "/api/graph", {"repo": ["r"], "limit": ["x"]})[0], 400)
        self.assertEqual(api.handle("GET", "/api/nope", {})[0], 404)


if __name__ == "__main__":
    unittest.main()
