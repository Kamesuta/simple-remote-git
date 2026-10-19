// 画面の殻を持っておき、電波が悪くても開けるようにする。API は常にネットへ(古いグラフを見せないため)。
// 殻もネットを先に見る:直したらすぐ反映させたいので、持っている分は取れなかったときの予備にする。
// 持つファイルを名前の一覧で決めない(ファイルを分けるたびに一覧がずれる)。一度取れたものをそのまま持つ
const CACHE = "srg-shell-v5";

self.addEventListener("install", (e) => {
  // 入口だけは先に持つ。ほかは開いたときに取れた分が溜まる
  e.waitUntil(caches.open(CACHE).then((c) => c.add("./")).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request)),
  );
});
