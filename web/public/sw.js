// Omicron's offline copy of the page. Online, the page always comes fresh
// from its Web Machine (and the copy is updated); offline, the copy loads,
// so the page can say it can't reach Omicron instead of the browser's blank
// error. Only the page and its files are kept: never data or sign-ins.
const CACHE = "omicron-page-v1";

/** Keep the page and every file it names (scripts, styles, fonts). */
async function keepPage(cache) {
  const res = await fetch("/", { cache: "no-store" });
  if (!res.ok) return;
  const html = await res.clone().text();
  await cache.put("/", res);
  const files = [...new Set([...html.matchAll(/["'(](\/assets\/[^"')]+)/g)].map((m) => m[1]))];
  // Only what isn't kept already (a file's name changes when it does).
  await Promise.all(files.map(async (f) => (await cache.match(f)) || cache.add(f).catch(() => {})));
}

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(keepPage));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (req.mode === "navigate") {
    // Every address is the same page.
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then(keepPage).catch(() => {});
          return res;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }
  // The page's files have their content in their names, so a kept copy is
  // always right.
  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
