"""スマホで Git Graph を見るための小さな HTTP サーバー。

127.0.0.1 だけで待ち、外へは tailscale serve で tailnet の中にだけ出す(serve.sh)。
  GET  /api/repos            最近使ったリポ 6 個
  GET  /api/graph?repo=名前  グラフ用のコミット列
  POST /api/fetch?repo=名前  git fetch --all
それ以外は web/ の静的ファイル。
"""
import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import gitdata
import worktree

HOST = "127.0.0.1"
PORT = int(os.environ.get("SRG_PORT", "7420"))
WEB = Path(__file__).resolve().parent / "web"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(WEB), **kw)

    # 画面の殻は Service Worker が持つので、ブラウザ側のキャッシュで古いのを掴まないようにする
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def _json(self, code: int, body) -> None:
        data = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _repo(self, q: dict):
        name = (q.get("repo") or [""])[0]
        path = gitdata.resolve(name)
        if path is None:
            self._json(404, {"error": f"そのリポは一覧に無い: {name}"})
        return path

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        if u.path == "/api/repos":
            return self._json(200, gitdata.list_repos())
        if u.path == "/api/graph":
            repo = self._repo(q)
            if repo is None:
                return
            try:
                limit = max(1, min(2000, int((q.get("limit") or ["400"])[0])))
                return self._json(200, worktree.decorate(repo, gitdata.graph(repo, limit)))
            except (ValueError, RuntimeError) as e:
                return self._json(500, {"error": str(e)})
        if u.path.startswith("/api/"):
            return self._json(404, {"error": "無い API"})
        return super().do_GET()

    def do_POST(self):
        u = urlparse(self.path)
        if u.path != "/api/fetch":
            return self._json(404, {"error": "無い API"})
        repo = self._repo(parse_qs(u.query))
        if repo is not None:
            res = gitdata.fetch(repo)
            self._json(200 if res["ok"] else 502, res)

    def log_message(self, fmt, *args):
        # 静的ファイルの行は多いだけなので API だけ出す
        if "/api/" in (args[0] if args else ""):
            sys.stderr.write("%s %s\n" % (self.log_date_time_string(), fmt % args))


# 古い Python の既定表には manifest が無く、iOS がホーム画面に追加するときに読めないので足す
Handler.extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                          ".webmanifest": "application/manifest+json", ".js": "text/javascript",
                          ".mjs": "text/javascript", ".svg": "image/svg+xml"}

if __name__ == "__main__":
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"http://{HOST}:{PORT}/  (root: {gitdata.ROOT})", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
