/* 그라시안의 잠언 300 — Service Worker */
const VERSION = "v3";
const CORE = `gracian-core-${VERSION}`;
const RUNTIME = `gracian-runtime-${VERSION}`;
const META = "gracian-meta"; // 알림 설정 저장용 (버전과 무관하게 유지)
const CORE_FILES = [
  "./", "./index.html", "./widget.html", "./maxims.json", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png", "./icons/favicon-48.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CORE).then(c => c.addAll(CORE_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith("gracian-") && k !== CORE && k !== RUNTIME && k !== META).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // 페이지 이동: 네트워크 우선(업데이트 반영) → 실패 시 캐시
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        const c = await caches.open(CORE);
        c.put(url.pathname.endsWith("widget.html") ? "./widget.html" : "./index.html", res.clone());
        return res;
      } catch (_) {
        const c = await caches.open(CORE);
        return (await c.match(url.pathname.endsWith("widget.html") ? "./widget.html" : "./index.html")) || (await c.match("./"));
      }
    })());
    return;
  }

  // 웹폰트·CDN: 캐시 우선
  if (/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/.test(url.host)) {
    e.respondWith((async () => {
      const c = await caches.open(RUNTIME);
      const hit = await c.match(req);
      if (hit) return hit;
      try { const res = await fetch(req); if (res.ok || res.type === "opaque") c.put(req, res.clone()); return res; }
      catch (_) { return hit || Response.error(); }
    })());
    return;
  }

  // 같은 출처 정적 파일: 캐시 후 백그라운드 갱신
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      const c = await caches.open(CORE);
      const hit = await c.match(req, { ignoreSearch: true });
      const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
      return hit || (await net) || Response.error();
    })());
  }
});

/* ---------- 오늘의 잠언 (index.html·widget.html과 같은 계산) ---------- */
function todayNumber(d = new Date()) {
  const seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  let h = seed; h = ((h ^ 61) ^ (h >>> 16)) * 9; h ^= h >>> 4; h = Math.imul(h, 0x27d4eb2d); h ^= h >>> 15;
  return (Math.abs(h) % 300) + 1;
}
const dayKey = (d = new Date()) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

async function getSettings() {
  const c = await caches.open(META);
  const r = await c.match("./__notify-settings");
  return r ? r.json() : { enabled: false, hour: 8, minute: 0, last: "" };
}
async function saveSettings(s) {
  const c = await caches.open(META);
  await c.put("./__notify-settings", new Response(JSON.stringify(s), { headers: { "Content-Type": "application/json" } }));
}
async function getMaxim(n) {
  let res = await caches.match("./maxims.json", { ignoreSearch: true });
  if (!res) res = await fetch("./maxims.json");
  const all = await res.json();
  return all[n - 1];
}
async function showDaily(force = false) {
  const s = await getSettings();
  const now = new Date();
  if (!force) {
    if (!s.enabled || s.last === dayKey(now)) return;
    if (now.getHours() * 60 + now.getMinutes() < s.hour * 60 + s.minute) return;
  }
  const n = todayNumber(now);
  const m = await getMaxim(n);
  await self.registration.showNotification(`오늘의 잠언 · No.${n}`, {
    body: `${m.t}\n${m.d}`,
    icon: "./icons/icon-192.png",
    badge: "./icons/favicon-48.png",
    tag: "gracian-daily",
    renotify: true,
    data: { url: `./?today=1#${n}` }
  });
  if (!force) { s.last = dayKey(now); await saveSettings(s); }
}

// Chrome(안드로이드·데스크톱)에 설치된 PWA에서 주기적으로 깨어나 알림
self.addEventListener("periodicsync", e => {
  if (e.tag === "gracian-daily") e.waitUntil(showDaily());
});

// 페이지에서 보내는 메시지: 설정 저장 / 테스트 알림 / 시간 확인
self.addEventListener("message", e => {
  const { type, payload } = e.data || {};
  if (type === "notify-settings") e.waitUntil(getSettings().then(s => saveSettings({ ...s, ...payload })));
  if (type === "notify-test") e.waitUntil(showDaily(true));
  if (type === "notify-check") e.waitUntil(showDaily());
});

// 향후 서버 푸시를 붙일 때를 위한 처리
self.addEventListener("push", e => {
  e.waitUntil(showDaily(true));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || "./", self.registration.scope).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope) && "focus" in w) { await w.navigate(target).catch(() => {}); return w.focus(); }
    }
    return self.clients.openWindow(target);
  })());
});
