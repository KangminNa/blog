// 브라우저 푸시를 받는 서비스 워커 (7단계). 사이트 뿌리(/sw.js)에서 내야 범위가 사이트 전체다.
// 서버가 보낸 푸시(제목 · 본문 · 주소 · tag, NoticePolicy의 PushMessage)를 알림으로 띄우고, 누르면 그 콘솔 주소를 연다.
// 주소는 이 사이트 안만 연다: 푸시 내용이 다른 사이트로 데려가지 못하게.
// 정적 파일(public/)이 아니라 경로로 낸다: 운영 이미지가 .next만 옮기고, 새 판이 바로 쓰이게 캐시하지 않는다.
export const dynamic = 'force-static';

const WORKER = `
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Cairn', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Cairn', {
      body: data.body || '',
      tag: data.tag || undefined,
      data: { link: data.link || '/admin' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = new URL((event.notification.data && event.notification.data.link) || '/admin', self.location.origin);
  if (link.origin !== self.location.origin) return;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin !== link.origin) continue;
        await client.focus();
        if ('navigate' in client) return client.navigate(link.href).catch(() => self.clients.openWindow(link.href));
        return undefined;
      }
      return self.clients.openWindow(link.href);
    })(),
  );
});
`;

export function GET(): Response {
  return new Response(WORKER, {
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-cache',
      'service-worker-allowed': '/',
    },
  });
}
