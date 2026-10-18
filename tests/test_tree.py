"""ファイルのタブ用の一覧(tree)を確かめる。差分の無いファイルも出し、gitignore されたものは出さない。"""
from helpers import TmpCase, git, make_repo
import safe  # noqa: E402
import tree  # noqa: E402


class Tree(TmpCase):
    def setUp(self):
        super().setUp()
        self.repo = make_repo(self.root, "r")  # a.txt
        (self.repo / "docs").mkdir()
        (self.repo / "docs" / "b.md").write_text("b")
        (self.repo / ".gitignore").write_text(".env\n")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-qm", "docs")
        git(self.repo, "tag", "-a", "v1", "-m", "v1")
        self.h = git(self.repo, "rev-parse", "HEAD")

    def test_worktree_lists_all_with_marks(self):
        (self.repo / "a.txt").write_text("changed")
        (self.repo / "new.txt").write_text("n")
        (self.repo / ".env").write_text("SECRET")
        t = tree.tree(self.repo, "wt:作業ツリー")
        self.assertEqual(t["files"], [".gitignore", "a.txt", "docs/b.md", "new.txt"])
        self.assertEqual(t["marks"], {"a.txt": "M", "new.txt": "U"})

    def test_commit_version_and_refs(self):
        self.assertEqual(tree.tree(self.repo, self.h)["files"], [".gitignore", "a.txt", "docs/b.md"])
        with self.assertRaises(safe.Bad):
            tree.tree(self.repo, "main")
        r = tree.refs(self.repo)
        self.assertEqual([b["name"] for b in r["branches"]], ["main"])
        self.assertEqual(r["tags"], [{"name": "v1", "sha": self.h}])  # 注釈付きタグはコミットを指す
        self.assertTrue(r["worktrees"][0]["main"])
