/* 무진 PWA 서비스워커 (FCM 통합판)
   - 앱 셸: 네트워크 우선 + 오프라인 시 캐시 폴백
   - FCM 백그라운드 푸시 수신도 이 파일이 담당
     (firebase-messaging-sw.js는 더 이상 사용하지 않음 — 같은 스코프에
      서비스워커 2개를 등록하면 서로를 밀어내서 푸시가 깨졌음) */

importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCIwydl1W9ODV-RcNi6b5xyiPSQfHxgOnM",
  authDomain: "insurance-manager-c4308.firebaseapp.com",
  projectId: "insurance-manager-c4308",
  storageBucket: "insurance-manager-c4308.firebasestorage.app",
  messagingSenderId: "769412429451",
  appId: "1:769412429451:web:0c3a31bb14430f8fe5068e"
});

const messaging = firebase.messaging();

// 백그라운드에서 메시지가 오면 알림으로 표시
messaging.onBackgroundMessage(function(payload){
  const n = payload.notification || {};
  const title = n.title || '새 공지';
  const options = {
    body: n.body || '',
    icon: 'favicon.png',
    badge: 'favicon.png',
    data: payload.data || {},
    tag: 'mujin-notice'
  };
  self.registration.showNotification(title, options);
});

// 알림을 누르면 공지 페이지를 열거나 이미 열린 탭으로 포커스
self.addEventListener('notificationclick', function(event){
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list){
      for (const c of list){
        if (c.url.includes('notice.html') && 'focus' in c) return c.focus();
      }
      if (clients.openWindow) return clients.openWindow('notice.html');
    })
  );
});

/* ── 앱 셸 캐시 ───────────────────────────────────── */
const CACHE = 'mujin-shell-v19';
const SHELL = [
  'index.html','admin.html','viewer.html','dashboard.html',
  'income-simulator.html','notice.html','awards-compare.html',
  'search-engine.js','coverage-summary.js',
  'manifest-admin.webmanifest','manifest-viewer.webmanifest',
  'icon-192.png','icon-512.png','icon-maskable-512.png','apple-touch-icon.png','favicon.png',
  'viewer-icon-192.png','viewer-icon-512.png','viewer-icon-maskable-512.png','viewer-apple-touch-icon.png','viewer-favicon.png'
];

self.addEventListener('install', e => {
  self.skipWaiting();
  // addAll은 하나만 404여도 전체 실패하므로, 파일별로 개별 시도
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.allSettled(SHELL.map(u => c.add(u)))
    )
  );
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
      // 정상 응답만 캐시 (404/500이 캐시에 박히는 것 방지)
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(()=>{});
      }
      return res;
    }).catch(() =>
      caches.match(req).then(r => {
        if (r) return r;
        // 페이지 이동일 때만 index.html 폴백 (JS/이미지 요청에 HTML을 주면 안 됨)
        if (req.mode === 'navigate') return caches.match('index.html');
        return Response.error();
      })
    )
  );
});
