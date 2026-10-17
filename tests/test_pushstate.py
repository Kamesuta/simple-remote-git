"""未プッシュの印と ahead / behind を、手元に作った bare の remote で確かめる。"""
import unittest

from helpers import TmpCase, git, make_repo
import graphlog  # noqa: E402
import pushstate  # noqa: E402


class Mark(TmpCase):
    def setUp(self):
        super().setUp()
        self.repo = make_repo(self.root, "r")
        git(self.root, "init", "-q", "--bare", "-b", "main", str(self.root / "remote.git"))
        git(self.repo, "remote", "add", "origin", str(self.root / "remote.git"))
        git(self.repo, "push", "-q", "-u", "origin", "main")

    def graph(self):
        return pushstate.mark(self.repo, graphlog.graph(self.repo))["commits"]

    def test_local_commit_is_unpushed_and_ahead(self):
        (self.repo / "a.txt").write_text("2")
        git(self.repo, "commit", "-qam", "local")
        top, base = self.graph()
        self.assertFalse(top["pushed"])
        self.assertTrue(base["pushed"])
        head = next(r for r in top["refs"] if r["t"] == "head")
        self.assertEqual((head["ahead"], head["behind"]), (1, 0))

    def test_no_remote_leaves_no_marks(self):
        git(self.repo, "remote", "remove", "origin")
        self.assertNotIn("pushed", self.graph()[0])

    def test_parse_track(self):
        t = pushstate.parse_track("dev\x1fahead 2, behind 1\nx\x1fbehind 3\ny\x1fgone\nz\x1f\n")
        self.assertEqual(t, {"dev": {"ahead": 2, "behind": 1}, "x": {"ahead": 0, "behind": 3}, "y": {"gone": True}})


if __name__ == "__main__":
    unittest.main()
