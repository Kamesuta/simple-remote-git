// 差分の画面が開いたファイルについて、要るものを揃える:
// 前後に送るファイルの並び・見出し・「ファイル」で読む版(ref)・差分の取り方。
// どこから開いたか(コミット・スタッシュ・未コミット・貼ったパス)で取り方が違うのを、ここで吸収する。
import { getChanges, getCommit, getLog, getStash } from "../lib/api.js";
import { PARTS } from "../lib/route.js";

const short = (h) => h.slice(0, 7);

export async function sources(r) {
  if (r.src === "commit") {
    const d = await getCommit(r.repo, r.h);
    return {
      title: d.s, sub: short(d.h), files: d.files,
      route: (f) => ({ repo: r.repo, view: "diff", src: "commit", h: r.h, path: f.path, old: f.old }),
      ref: (f) => (f.status === "D" ? d.p[0] : d.h),
      diff: (f) => ({ src: "commit", h: d.h, path: f.path, old: f.old }),
    };
  }
  if (r.src === "stash") {
    const d = await getStash(r.repo, r.name);
    return {
      title: d.s, sub: r.name, files: d.files,
      route: (f) => ({ repo: r.repo, view: "diff", src: "stash", name: r.name, path: f.path, old: f.old }),
      // untracked の分はスタッシュの 3 番目の親に入っている
      ref: (f) => (f.untracked ? d.p[2] : f.status === "D" ? d.p[0] : d.h),
      diff: (f) => ({ src: "stash", name: r.name, path: f.path, old: f.old }),
    };
  }
  if (PARTS.includes(r.src)) {
    const wt = (await getChanges(r.repo)).find((w) => w.name === r.wt);
    if (!wt) throw new Error(`ワークツリーが見つからない: ${r.wt}`);
    // 前後に送る並びは、変更のタブと同じ「ステージ済み → 未ステージ → 新しいファイル」
    const files = PARTS.flatMap((part) => wt[part].map((f) => ({ ...f, part })));
    return {
      title: wt.branch ?? wt.name, sub: "未コミット", files, part: r.src,
      route: (f) => ({ repo: r.repo, view: "diff", src: f.part, wt: r.wt, path: f.path, old: f.old }),
      ref: (f) => (f.status === "D" ? wt.head : `wt:${r.wt}`),
      diff: (f) => ({ src: f.part, wt: r.wt, path: f.path, old: f.old }),
    };
  }
  return openSource(r);
}

// 貼ったパス。前後は無い。差分は、未コミットの変更があればそれ、無ければ最後にそのファイルを変えたコミット
async function openSource(r) {
  const f = { path: r.path, status: "M" };
  let diff = null;
  if (r.ref.startsWith("wt:")) {
    const wt = (await getChanges(r.repo)).find((w) => w.name === r.ref.slice(3));
    const part = wt && PARTS.find((p) => wt[p].some((x) => x.path === r.path));
    if (part) diff = { src: part, wt: wt.name, path: r.path, note: "未コミットの変更" };
  }
  if (!diff) {
    const [last] = await getLog(r.repo, { ref: r.ref, path: r.path, n: 1 });
    if (last) diff = { src: "commit", h: last.h, path: r.path, note: `最後に変えたコミット ${short(last.h)}: ${last.s}` };
  }
  return {
    title: r.ref.startsWith("wt:") ? r.ref.slice(3) : short(r.ref), sub: "貼ったパス", files: [f],
    route: () => r, ref: () => r.ref, diff: () => diff,
  };
}
