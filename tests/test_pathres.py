"""貼ったパスの読み替え(pathres)を、一時フォルダに作ったリポとワークツリーで確かめる。"""
import unittest
from unittest import mock

from helpers import TmpCase, git, make_repo
import gitdata  # noqa: E402
import pathres  # noqa: E402


class SplitLine(unittest.TestCase):
    def test_forms(self):
        self.assertEqual(pathres.split_line("web/app.js:120"), ("web/app.js", 120))
        self.assertEqual(pathres.split_line("`a/b.py:12:3`"), ("a/b.py", 12))
        self.assertEqual(pathres.split_line("docs/x.md#L42-L50"), ("docs/x.md", 42))
        self.assertEqual(pathres.split_line(" file:///Users/a/b.txt "), ("/Users/a/b.txt", None))


class Resolve(TmpCase):
    def setUp(self):
        super().setUp()
        self.a = make_repo(self.root, "alpha")
        self.b = make_repo(self.root, "bundle/beta")
        (self.b / "only-in-beta.txt").write_text("b")
        git(self.a, "worktree", "add", "-q", str(self.a / ".claude" / "worktrees" / "feat-x"), "-b", "x")
        self.outside = self.root / "elsewhere"
        git(self.a, "worktree", "add", "-q", str(self.outside), "-b", "y")
        patcher = mock.patch.object(gitdata, "ROOT", self.root)
        patcher.start()
        self.addCleanup(patcher.stop)

    def one(self, text, current="alpha"):
        m = pathres.resolve(text, current)["matches"]
        self.assertEqual(len(m), 1, m)
        return m[0]["repo"], m[0]["wt"], m[0]["path"], m[0]["line"]

    def test_absolute_and_home_style(self):
        self.assertEqual(self.one(f"{self.a}/a.txt:3"), ("alpha", "作業ツリー", "a.txt", 3))
        self.assertEqual(self.one(f"{self.b}/a.txt"), ("bundle/beta", "作業ツリー", "a.txt", None))

    def test_worktrees_inside_and_outside_the_repo(self):
        self.assertEqual(self.one(f"{self.a}/.claude/worktrees/feat-x/a.txt"), ("alpha", "feat-x", "a.txt", None))
        self.assertEqual(self.one(".claude/worktrees/feat-x/a.txt"), ("alpha", "feat-x", "a.txt", None))
        self.assertEqual(self.one(f"{self.outside}/a.txt"), ("alpha", "elsewhere", "a.txt", None))

    def test_relative_prefers_current_then_other_repos(self):
        self.assertEqual(self.one("a.txt", current="bundle/beta")[0], "bundle/beta")
        self.assertEqual(self.one("only-in-beta.txt")[0], "bundle/beta")  # 今のリポに無ければほかを探す
        self.assertEqual(self.one("bundle/beta/a.txt")[0], "bundle/beta")
        self.assertEqual(pathres.resolve("nope.txt", "alpha")["matches"], [])
        self.assertEqual(pathres.resolve(str(self.a), "alpha")["matches"], [])  # リポそのものは開けない


if __name__ == "__main__":
    unittest.main()
