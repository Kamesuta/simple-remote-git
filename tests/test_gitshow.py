"""コミット・スタッシュの詳細(gitshow)と、ワークツリーの未コミット(wipfiles)を確かめる。"""
import unittest

from helpers import TmpCase, git, make_repo
import gitshow  # noqa: E402
import safe  # noqa: E402
import wipfiles  # noqa: E402


class Parse(unittest.TestCase):
    def test_name_status_and_numstat(self):
        ns = "M\0a.txt\0R100\0old.js\0web/新.js\0A\0bin.png\0"
        num = "3\t1\ta.txt\0" "0\t0\t\0old.js\0web/新.js\0" "-\t-\tbin.png\0"
        files = gitshow.merge_files(ns, num)
        self.assertEqual([(f["status"], f["path"], f.get("old")) for f in files],
                         [("M", "a.txt", None), ("R", "web/新.js", "old.js"), ("A", "bin.png", None)])
        self.assertEqual((files[0]["add"], files[0]["del"]), (3, 1))
        self.assertTrue(files[2]["binary"])

    def test_status_v2(self):
        z = ("1 M. N... 100644 100644 100644 aa bb s.txt\0"
             "1 .M N... 100644 100644 100644 aa bb u.txt\0"
             "2 R. N... 100644 100644 100644 aa bb R100 new name.txt\0old.txt\0"
             "? 新しい.txt\0")
        out = wipfiles.parse_status_v2(z)
        self.assertEqual([f["path"] for f in out["staged"]], ["s.txt", "new name.txt"])
        self.assertEqual(out["staged"][1]["old"], "old.txt")
        self.assertEqual([f["path"] for f in out["unstaged"]], ["u.txt"])
        self.assertEqual([f["path"] for f in out["untracked"]], ["新しい.txt"])


class Show(TmpCase):
    def setUp(self):
        super().setUp()
        self.repo = make_repo(self.root, "r")

    def test_root_rename_and_merge(self):
        root = gitshow.commit(self.repo, git(self.repo, "rev-parse", "HEAD"))
        self.assertEqual([(f["status"], f["path"]) for f in root["files"]], [("A", "a.txt")])
        self.assertFalse(root["pushed"])
        git(self.repo, "mv", "a.txt", "b.txt")
        git(self.repo, "commit", "-qm", "rename\n\n本文の 1 行目")
        c = gitshow.commit(self.repo, git(self.repo, "rev-parse", "HEAD"))
        self.assertEqual((c["files"][0]["status"], c["files"][0]["old"]), ("R", "a.txt"))
        self.assertEqual(c["body"], "本文の 1 行目")
        git(self.repo, "checkout", "-qb", "side", "HEAD~1")
        (self.repo / "s.txt").write_text("s\n")
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-qm", "side")
        git(self.repo, "checkout", "-q", "main")
        git(self.repo, "merge", "-q", "--no-ff", "-m", "merge", "side")
        m = gitshow.commit(self.repo, git(self.repo, "rev-parse", "HEAD"))
        self.assertEqual([f["path"] for f in m["files"]], ["s.txt"])  # 第 1 親と比べる
        with self.assertRaises(safe.NotFound):
            gitshow.commit(self.repo, "deadbeef")

    def test_stash_with_untracked(self):
        (self.repo / "a.txt").write_text("changed\n")
        (self.repo / "new.txt").write_text("n\n")
        git(self.repo, "stash", "push", "-q", "-u", "-m", "退避")
        st = gitshow.stash(self.repo, "stash@{0}")
        self.assertEqual(sorted((f["path"], bool(f.get("untracked"))) for f in st["files"]),
                         [("a.txt", False), ("new.txt", True)])

    def test_changes_split(self):
        (self.repo / "a.txt").write_text("1\n2\n")
        git(self.repo, "add", "a.txt")
        (self.repo / "a.txt").write_text("1\n2\n3\n")
        (self.repo / "dir").mkdir()
        (self.repo / "dir" / "n.txt").write_text("x\ny")
        wt = wipfiles.changes(self.repo)[0]
        self.assertTrue(wt["main"])
        self.assertEqual([(f["path"], f["add"]) for f in wt["staged"]], [("a.txt", 2)])
        self.assertEqual([(f["path"], f["add"]) for f in wt["unstaged"]], [("a.txt", 1)])
        self.assertEqual([(f["path"], f["add"]) for f in wt["untracked"]], [("dir/n.txt", 2)])


if __name__ == "__main__":
    unittest.main()
