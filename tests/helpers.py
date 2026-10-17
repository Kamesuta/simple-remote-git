"""テストの道具。一時フォルダに本物の git リポを作る(git の設定は本人のものを読まない)。"""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

ENV = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@example.com",
           GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@example.com", GIT_CONFIG_GLOBAL="/dev/null")


def git(cwd, *args):
    return subprocess.run(["git", "-C", str(cwd), *args], check=True, capture_output=True,
                          text=True, env=ENV).stdout.strip()


def make_repo(root: Path, name: str) -> Path:
    d = root / name
    d.mkdir(parents=True)
    git(d, "init", "-q", "-b", "main")
    (d / "a.txt").write_text("1")
    git(d, "add", ".")
    git(d, "commit", "-qm", "first")
    return d


def touch(p: Path, t: float):
    os.utime(p, (t, t))


class TmpCase(unittest.TestCase):
    """self.root に空の一時フォルダを用意する。"""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name).resolve()

    def tearDown(self):
        self.tmp.cleanup()
