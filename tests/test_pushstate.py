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

    def test_archived_refs_stay_out_but_detached_worktree_shows(self):
        # 退避した ref(refs/archive)の先だけにあるコミットは、グラフにも未プッシュにも出さない
        git(self.repo, "checkout", "-q", "-b", "old")
        (self.repo / "a.txt").write_text("old")
        git(self.repo, "commit", "-qam", "archived")
        git(self.repo, "update-ref", "refs/archive/old", "HEAD")
        git(self.repo, "checkout", "-q", "main")
        git(self.repo, "branch", "-qD", "old")
        # HEAD を切り離したワークツリーのコミットは出す
        git(self.repo, "worktree", "add", "-q", "--detach", str(self.root / "wt"))
        (self.root / "wt" / "a.txt").write_text("wt")
        git(self.root / "wt", "commit", "-qam", "detached")
        subjects = [c["s"] for c in self.graph()]
        self.assertNotIn("archived", subjects)
        self.assertIn("detached", subjects)
        self.assertEqual(len(pushstate.unpushed(self.repo)), 1)

    def test_no_remote_leaves_no_marks(self):
        git(self.repo, "remote", "remove", "origin")
        self.assertNotIn("pushed", self.graph()[0])

    def test_parse_track(self):
        t = pushstate.parse_track("dev\x1fahead 2, behind 1\nx\x1fbehind 3\ny\x1fgone\nz\x1f\n")
        self.assertEqual(t, {"dev": {"ahead": 2, "behind": 1}, "x": {"ahead": 0, "behind": 3}, "y": {"gone": True}})


if __name__ == "__main__":
    unittest.main()
