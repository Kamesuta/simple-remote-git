# simple-remote-git

スマホで見る Git Graph。Mac で小さなサーバーを立て、`~/softdata/git` の中から最近使ったリポ 6 個のグラフを
縦スクロールで見る。開くたびに裏で `git fetch` し、終わったら描き直す。行をタップすると GitHub のコミットページが開く。

Git Graph のようにブランチ・タグ・スタッシュを全部出したうえで、**ワークツリーを目立たせる**:

- ワークツリーで開いているブランチは緑のチップ + フォルダの印(本体の作業ツリーは濃い緑)
- 未コミットの変更はワークツリーごとに 1 行、その HEAD の真上に点線でつなぐ
- スタッシュは作ったときのコミットの真上に、紫の四角で出す

依存はゼロ(Python 標準ライブラリと素の HTML/JS)。ビルドも venv も要らない。

## 使い方

```sh
graph-share          # tmux(graph)で立て、tailscale serve で tailnet にだけ出して URL を出す
graph-share stop     # 畳む(tailscale serve は 7443 だけ外す)
graph-share attach   # ログを見る
```

出た URL(`https://<mac>.<tailnet>.ts.net:7443/`)をスマホで開き、ホーム画面に追加すればアプリのように開ける。
Claude Code からは「Git Graph 立てて」で `~/.claude/skills/git-graph` が呼ぶ。

## 作り

| ファイル | 役目 |
| --- | --- |
| `server.py` | `127.0.0.1:7420` で待つ。`/api/repos`・`/api/graph`・`POST /api/fetch` と `web/` の配信 |
| `gitdata.py` | 最近使ったリポの一覧、`git log` の読み取り、フェッチ |
| `worktree.py` | ワークツリー・未コミット・スタッシュを読み、コミット列に差し込む |
| `web/graph.js` | レーンの割り付けと SVG の描画 |
| `web/app.js` | 画面の流れ(即描画 → フェッチ → 描き直し) |

- 「最近使った」は `.git/index`・`.git/logs/HEAD` とワークツリー側の同じファイルの更新時刻で決める。
  `FETCH_HEAD` は数えない(自動フェッチで順位が動かないように)。`git status` は `--no-optional-locks` で叩き、見ただけで index を書き換えない
- リポ名は一覧にある名前と完全一致したものだけ受ける(外からパスを渡させない)
- 見た目は Design キャンバスで決めたもの
- アイコンの線は [Lucide](https://lucide.dev) の `git-graph`(ISC License)

## テスト

```sh
python3 -m unittest discover tests
node --test tests/*.test.mjs
```

`SRG_ROOT`(リポを探す場所)と `SRG_PORT`(待つポート)で、試しのリポに向けたサーバーも立てられる。
