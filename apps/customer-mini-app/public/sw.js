/**
 * عامل خدمة «وصلة» (XR-8.3 · CLM-0665 · المراجعة 6 للخارطة المشتركة).
 *
 * استراتيجية مقصودة الحدّ وسلامةً أولًا:
 * - الشبكةُ أولًا دائمًا: لا تُقدَّم استجابةٌ من الذاكرة إلا إذا فشل الطلب شبكيًا،
 *   فلا تصل بياناتٌ قديمةٌ إلى المستخدم أبدًا وهو متصل.
 * - الذاكرةُ للتخزينِ الآمنِ وحدَه: طلبات GET من نفس الأصل فقط، وباستثناءٍ صريحٍ
 *   لمسارات الواجهة المصادق عليها (`/edge/` و`/api/`) حتى لا تُخزَّن بيانات جلسة
 *   ولا تُقدَّم استجابة مصادق عليها من الذاكرة (ADR-044 §4).
 * - فشلُ كلِّ شيءٍ يعيد استجابة 503 صريحة لا صفحةً مضلِّلة.
 *
 * القيمة: بهذا الملف يصبح التطبيق قابلًا للتثبيت (PWA) على الحاسوب
 * وعلى أندرويد وآيفون من المتصفح، مع عملٍ محدودٍ دون اتصال للأصول الثابتة.
 */
const RUNTIME_CACHE = "wasla-customer-runtime-v1";
const EXCLUDED_PATH_PREFIXES = ["/edge/", "/api/"];

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== RUNTIME_CACHE).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (EXCLUDED_PATH_PREFIXES.some((p) => url.pathname.startsWith(p))) return;
  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(RUNTIME_CACHE);
          cache.put(request, response.clone());
        }
        return response;
      } catch {
        const cached = await caches.match(request);
        if (cached) return cached;
        return new Response("offline", { status: 503 });
      }
    })(),
  );
});
