// 강의 요약 위젯 서비스 워커 — 앱 설치(PWA) + 화면 파일 오프라인 캐시
// 화면(index.html)은 "네트워크 먼저, 실패하면 캐시". 다른 사이트(모델 · CDN) 요청은 건드리지 않습니다
// (Whisper · WebLLM 모델은 라이브러리가 브라우저 저장소에 따로 보관합니다).
const CACHE = 'lw-shell-v2';
const SHELL = ['./', './index.html', './manifest.webmanifest', './pwa/icon-192.png', './pwa/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('lw-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html'))),
  );
});
