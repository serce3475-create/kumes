// Kümes Defterim - çevrimdışı önbellek. İnternet varken hep en yeni dosya, yoksa önbellek.
// Her yeni sürümde aşağıdaki V değeri artırılır; telefon bunu fark edip "Yeni sürüm hazır" gösterir.
const V = 'kumes-v6';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'logo.png', 'og.png', 'kilavuz.html'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
  // skipWaiting yok: kullanıcı "Güncelle"ye dokununca devreye girer (açık ekran bir anda değişmesin)
});

self.addEventListener('message', e => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== V).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Google/Drive istekleri doğrudan gitsin
  e.respondWith((async () => {
    const cache = await caches.open(V);
    try {
      // önce ağ (en fazla 4 sn), olmazsa önbellek
      const res = await Promise.race([
        fetch(req, { cache: 'no-cache' }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))
      ]);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch (_) {
      return (await cache.match(req, { ignoreSearch: true })) || (await cache.match('index.html')) || Response.error();
    }
  })());
});
