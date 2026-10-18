#!/bin/sh
# スマホ用の Git Graph(server.py)を tmux で立て、tailscale serve で tailnet の中にだけ出す。
# 常駐はしない。見たいときに立て、要らなくなったら畳む。
#
#   graph-share          立てて URL を出す(立っていれば URL を出し直すだけ)
#   graph-share attach   tmux に入ってログを見る(抜けるのは Ctrl-b d)
#   graph-share stop     畳む(tailscale serve は 7443 だけ外す)
#
# PATH の通った場所(~/.local/bin など)に graph-share という名前でこのファイルへのリンクを張って使う。
# 見るリポの場所は SRG_ROOT(既定はこのフォルダの親)。
#
# サーバーは 127.0.0.1 だけで待つ。外からは tailnet の HTTPS(7443)からしか届かない。
set -eu

SESSION=graph
PORT=7420
HTTPS_PORT=7443
# リンク越しに呼ばれると $0 はリンクの場所なので、実体をたどって server.py の隣を指す
DIR=$(dirname "$(realpath "$0")")
# Mac の App Store/公式版は PATH に入らず、対話シェルの alias でしか呼べないので中身を直に指す
TS=$(command -v tailscale || echo /Applications/Tailscale.app/Contents/MacOS/Tailscale)
tailscale() { "$TS" "$@"; }

url() {
  # MagicDNS の名前は tailscale に聞く(末尾の . を落とす)
  host=$(tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')
  echo "https://$host:$HTTPS_PORT/"
}

wait_ready() {
  i=0
  until curl -fsS "http://127.0.0.1:$PORT/api/repos" >/dev/null 2>&1; do
    i=$((i + 1))
    if [ $i -ge 30 ]; then
      echo "サーバーが返事をしない。graph-share attach で様子を見ること" >&2; exit 1
    fi
    sleep 0.5
  done
}

case "${1:-}" in
  stop)
    tmux kill-session -t "$SESSION" 2>/dev/null && echo "畳んだ" || echo "立っていない"
    # ほかのポートの設定(443・5175 など)には触らない
    tailscale serve --https="$HTTPS_PORT" off >/dev/null 2>&1 || true
    exit 0 ;;
  attach)
    exec tmux attach -t "$SESSION" ;;
  "") ;;
  *) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac

if ! tmux has-session -t "$SESSION" 2>/dev/null; then
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "ポート $PORT を誰かが使っている(lsof -nP -iTCP:$PORT で確かめること)" >&2; exit 1
  fi
  # 落ちてもログが見られるよう、終わったら Enter を待つ
  tmux new-session -d -s "$SESSION" "cd '$DIR' && SRG_ROOT='${SRG_ROOT:-}' python3 server.py; echo '(止まった。Enter で閉じる)'; read _"
fi
wait_ready
tailscale serve --bg --https="$HTTPS_PORT" "http://127.0.0.1:$PORT" >/dev/null
url
