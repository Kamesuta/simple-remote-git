"""スマホで Git Graph を見るための小さな HTTP サーバー。

127.0.0.1 だけで待ち、外へは tailscale serve で tailnet の中にだけ出す(serve.sh)。
/api/* は api.py が振り分ける(一覧は api.GET / api.POST)。それ以外は web/ の静的ファイル。
"""
import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import api
import gitdata

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

    def _send(self, code: int, body) -> None:
        if isinstance(body, api.Raw):
            data, ctype = body.data, body.ctype
        else:
            data, ctype = json.dumps(body, ensure_ascii=False).encode(), "application/json; charset=utf-8"
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _api(self, method: str) -> bool:
        u = urlparse(self.path)
        if not u.path.startswith("/api/"):
            return False
        self._send(*api.handle(method, u.path, parse_qs(u.query)))
        return True

    def do_GET(self):
        if not self._api("GET"):
            super().do_GET()

    def do_POST(self):
        if not self._api("POST"):
            self._send(404, {"error": "無い API"})

    def log_message(self, fmt, *args):
        # 静的ファイルの行は多いだけなので API だけ出す
        if "/api/" in (args[0] if args else ""):
            sys.stderr.write("%s %s\n" % (self.log_date_time_string(), fmt % args))


# 古い Python の既定表には manifest が無く、iOS がホーム画面に追加するときに読めないので足す
Handler.extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                          ".webmanifest": "application/manifest+json", ".js": "text/javascript",
                          ".mjs": "text/javascript", ".svg": "image/svg+xml"}


class Server(ThreadingHTTPServer):
    # 開いた瞬間に JS のモジュールと API がまとめて来る。既定の待ち行列 5 本ではあふれて接続を切られるため広げる
    request_queue_size = 128
    daemon_threads = True


if __name__ == "__main__":
    srv = Server((HOST, PORT), Handler)
    print(f"http://{HOST}:{PORT}/  (root: {gitdata.ROOT})", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
