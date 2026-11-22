// 강의 요약 위젯 서비스 워커 — 앱 설치(PWA) + 화면 파일 오프라인 캐시
// 화면(index.html)은 "네트워크 먼저, 실패하면 캐시". 다른 사이트(모델 · CDN) 요청은 건드리지 않습니다
// (Whisper · WebLLM 모델은 라이브러리가 브라우저 저장소에 따로 보관합니다).
const CACHE = 'lw-shell-v14';
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

// 화면 문서(HTML)에 COOP/COEP 헤더를 붙임 → crossOriginIsolated → 받아쓰기 CPU 여러 코어 사용
// credentialless: 다른 사이트(CDN · 모델 · 글꼴) 파일은 쿠키 없이 그대로 받아 옴
async function isolate(req, resP) {
  const res = await resP;
  if (!res || req.mode !== 'navigate') return res;
  const h = new Headers(res.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Embedder-Policy', 'credentialless');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return isolate(req, res);
      })
      .catch(() => caches.match(req).then((hit) => isolate(req, hit || caches.match('./index.html')))),
  );
});
