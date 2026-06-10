/* FCM 백그라운드 알림 수신 전용 서비스워커.
   앱이 꺼져 있거나 다른 탭에 있을 때 도착한 푸시를 화면에 띄웁니다.
   (기존 sw.js와는 별개 파일이라 서로 영향 없음) */

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
