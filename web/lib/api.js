// サーバーへの問い合わせ。行き来するたびに同じものを取り直さないよう、少しのあいだ覚えておく。
// コミットの中身は変わらないので長く、未コミットやスタッシュは変わるので短く。

export async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok && !("ok" in body)) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

export const q = (o) => Object.entries(o)
  .filter(([, v]) => v != null && v !== "")
  .map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

const memo = new Map();
function cached(key, ttl, fn) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.p;
  const p = fn().catch((e) => { memo.delete(key); throw e; });
  memo.set(key, { p, t: Date.now() });
  return p;
}
// フェッチの後や、画面に戻ってきたときに未コミットを取り直させる
export const forget = (prefix) => { for (const k of memo.keys()) if (k.startsWith(prefix)) memo.delete(k); };

export const getCommit = (repo, h) => cached(`c:${repo}:${h}`, 3600e3, () => api(`/api/commit?${q({ repo, h })}`));
export const getStash = (repo, name) => cached(`s:${repo}:${name}`, 10e3, () => api(`/api/stash?${q({ repo, name })}`));
export const getChanges = (repo) => cached(`w:${repo}`, 5e3, () => api(`/api/changes?${q({ repo })}`));
export const getDiff = (repo, o) => cached(`d:${repo}:${q(o)}`, o.src === "commit" ? 3600e3 : 5e3,
  () => api(`/api/diff?${q({ repo, ...o })}`));
export const getLog = (repo, o) => cached(`l:${repo}:${q(o)}`, 10e3, () => api(`/api/log?${q({ repo, ...o })}`));
export const fileUrl = (repo, ref, path) => `/api/file?${q({ repo, ref, path })}`;
export const getFile = (repo, ref, path) => cached(`f:${repo}:${ref}:${path}`, ref.startsWith("wt:") ? 5e3 : 3600e3,
  () => api(fileUrl(repo, ref, path)));
