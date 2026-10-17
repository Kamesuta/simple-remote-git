"""1 ファイルの差分と中身(diffs)を確かめる。"""
from helpers import TmpCase, git, make_repo
import diffs  # noqa: E402
import gitshow  # noqa: E402
import safe  # noqa: E402


class Diffs(TmpCase):
    def setUp(self):
        super().setUp()
        self.repo = make_repo(self.root, "r")  # a.txt = "1"
        self.base = git(self.repo, "rev-parse", "HEAD")
        (self.repo / "a.txt").write_text("1\n2\n")
        git(self.repo, "commit", "-qam", "two")
        self.h = git(self.repo, "rev-parse", "HEAD")

    def test_commit_and_root(self):
        d = diffs.diff(self.repo, "commit", "a.txt", h=self.h)
        self.assertIn("+2", d["text"])
        self.assertFalse(d["truncated"])
        self.assertIn("+1", diffs.diff(self.repo, "commit", "a.txt", h=self.base)["text"])

    def test_worktree_parts(self):
        (self.repo / "a.txt").write_text("1\n2\n3\n")
        git(self.repo, "add", "a.txt")
        (self.repo / "a.txt").write_text("1\n2\n3\n4\n")
        (self.repo / "n.txt").write_text("new\n")
        wt = "作業ツリー"
        self.assertIn("+3", diffs.diff(self.repo, "staged", "a.txt", wt=wt)["text"])
        self.assertIn("+4", diffs.diff(self.repo, "unstaged", "a.txt", wt=wt)["text"])
        self.assertIn("+new", diffs.diff(self.repo, "untracked", "n.txt", wt=wt)["text"])
        with self.assertRaises(safe.Bad):
            diffs.diff(self.repo, "unstaged", "../x", wt=wt)
        with self.assertRaises(safe.Bad):
            diffs.diff(self.repo, "weird", "a.txt", wt=wt)

    def test_stash_untracked_part(self):
        (self.repo / "u.txt").write_text("u\n")
        git(self.repo, "stash", "push", "-q", "-u")
        self.assertIn("+u", diffs.diff(self.repo, "stash", "u.txt", name="stash@{0}")["text"])

    def test_truncate(self):
        d = diffs.cap("\n".join(str(i) for i in range(diffs.MAX_LINES + 10)))
        self.assertTrue(d["truncated"])
        self.assertEqual(len(d["text"].split("\n")), diffs.MAX_LINES)


class Log(TmpCase):
    def test_last_commit_of_file(self):
        repo = make_repo(self.root, "r")
        (repo / "b.txt").write_text("b")
        git(repo, "add", ".")
        git(repo, "commit", "-qm", "b を足す")
        h = git(repo, "rev-parse", "HEAD")
        self.assertEqual([c["s"] for c in gitshow.log(repo, h, "a.txt", 5)], ["first"])
        self.assertEqual(gitshow.log(repo, "wt:作業ツリー", "b.txt")[0]["h"], h)


class Content(TmpCase):
    def setUp(self):
        super().setUp()
        self.repo = make_repo(self.root, "r")
        self.h = git(self.repo, "rev-parse", "HEAD")

    def test_text_image_and_refusals(self):
        body, ctype = diffs.content(self.repo, self.h, "a.txt")
        self.assertEqual((body["text"], body["sha"], ctype), ("1", self.h, None))
        (self.repo / "a.txt").write_text("作業中")
        self.assertEqual(diffs.content(self.repo, "wt:作業ツリー", "a.txt")[0]["text"], "作業中")
        (self.repo / "i.png").write_bytes(b"\x89PNG\r\n\0\0")
        self.assertEqual(diffs.content(self.repo, "wt:作業ツリー", "i.png")[1], "image/png")
        (self.repo / "b.bin").write_bytes(b"\0\1\2")
        self.assertTrue(diffs.content(self.repo, "wt:作業ツリー", "b.bin")[0]["binary"])
        (self.repo / ".gitignore").write_text(".env\n")
        (self.repo / ".env").write_text("SECRET")
        with self.assertRaises(safe.NotFound):
            diffs.content(self.repo, "wt:作業ツリー", ".env")
        with self.assertRaises(safe.NotFound):
            diffs.content(self.repo, self.h, "nope.txt")
        with self.assertRaises(safe.Bad):
            diffs.content(self.repo, "HEAD", "a.txt")
