/* 무진 PWA 서비스워커
   전략: 같은 출처(앱 셸) = 네트워크 우선 + 오프라인 시 캐시 폴백
        → 온라인이면 항상 최신(자동 업데이트 유지), 잠깐 끊겨도 화면은 뜸
   Firebase/gstatic 등 외부 출처는 가로채지 않고 그대로 네트워크로 보냄 */
const CACHE = 'mujin-shell-v15';
const SHELL = [
  'index.html','admin.html','viewer.html','dashboard.html','income-simulator.html',
  'search-engine.js','coverage-summary.js',
  'manifest-admin.webmanifest','manifest-viewer.webmanifest',
  'icon-192.png','icon-512.png','icon-maskable-512.png','apple-touch-icon.png','favicon.png'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(()=>{})));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Firebase 등 외부는 건드리지 않음

  e.respondWith(
    fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(()=>{});
      return res;
    }).catch(() =>
      caches.match(req).then(r => r || caches.match('index.html'))
    )
  );
});
