// URL の # と画面の状態を行き来する。# で表すのは、スマホの「戻る」を効かせ、
// ホーム画面から開き直しても同じ場所に戻れるようにするため。
// リポ名(games/server)とファイルのパスは / を含むので、1 段として丸ごと符号化する。
//
//   #/<repo>                         グラフ
//   #/<repo>/changes                 変更のタブ
//   #/<repo>/c/<sha>                 コミットの詳細      …/f/<path> でその差分
//   #/<repo>/s/<n>                   スタッシュの詳細    …/f/<path> でその差分
//   #/<repo>/w/<wt>/<part>/<path>    未コミットの差分(part は staged / unstaged / untracked)
//   #/<repo>/open/<ref>/<path>       パスを貼って開いたファイル(ref は SHA か wt:<名>)
//   ?v=file で差分でなくファイル、?line=42 でその行、?old= は名前変更の元の名前
const enc = encodeURIComponent;
const QUERY = ["v", "line", "old", "wt"];
export const PARTS = ["staged", "unstaged", "untracked"];

export function parse(hash) {
  const [pathPart, query = ""] = hash.replace(/^#\/?/, "").split("?");
  const seg = pathPart.split("/").filter(Boolean).map(decodeURIComponent);
  const r = { repo: seg[0] ?? null, view: "graph" };
  const params = new URLSearchParams(query);
  for (const k of QUERY) if (params.has(k)) r[k] = params.get(k);
  const [kind, a, b, c] = seg.slice(1);
  if (kind === "changes") r.view = "changes";
  else if (kind === "c" && a) Object.assign(r, b === "f" && c ? { view: "diff", src: "commit", h: a, path: c } : { view: "commit", h: a });
  else if (kind === "s" && a) {
    const name = `stash@{${a}}`;
    Object.assign(r, b === "f" && c ? { view: "diff", src: "stash", name, path: c } : { view: "stash", name });
  } else if (kind === "w" && a && PARTS.includes(b) && c) Object.assign(r, { view: "diff", src: b, wt: a, path: c });
  else if (kind === "open" && a && b) Object.assign(r, { view: "diff", src: "open", ref: a, path: b });
  return r;
}

export function build(r) {
  let s = `#/${enc(r.repo)}`;
  const stashN = () => r.name.slice(7, -1); // stash@{3} → 3
  if (r.view === "changes") s += "/changes";
  else if (r.view === "commit") s += `/c/${r.h}`;
  else if (r.view === "stash") s += `/s/${stashN()}`;
  else if (r.view === "diff") {
    if (r.src === "commit") s += `/c/${r.h}/f/${enc(r.path)}`;
    else if (r.src === "stash") s += `/s/${stashN()}/f/${enc(r.path)}`;
    else if (r.src === "open") s += `/open/${enc(r.ref)}/${enc(r.path)}`;
    else s += `/w/${enc(r.wt)}/${r.src}/${enc(r.path)}`;
  }
  const qs = new URLSearchParams();
  for (const k of QUERY) {
    if (k === "wt" && r.view === "diff") continue; // 差分の wt は段に入っている
    if (r[k] != null && r[k] !== "") qs.set(k, r[k]);
  }
  const tail = qs.toString();
  return tail ? `${s}?${tail}` : s;
}

// 下のタブのどちらの上に重ねるか。未コミットの差分は変更のタブから開くので、戻ったときもそこにいる
export const tabOf = (r) => (r.view === "changes" || PARTS.includes(r.src) ? "changes" : "graph");

// 「戻る」で行く先。アプリの中で積んだ履歴が無い(開き直した・貼ったリンクから来た)ときに使う
export function parent(r) {
  if (r.view === "diff" && r.src === "commit") return { repo: r.repo, view: "commit", h: r.h };
  if (r.view === "diff" && r.src === "stash") return { repo: r.repo, view: "stash", name: r.name };
  if (r.view === "diff" && PARTS.includes(r.src)) return { repo: r.repo, view: "changes", wt: r.wt };
  return { repo: r.repo, view: tabOf(r) === "changes" && r.view !== "changes" ? "changes" : "graph" };
}
