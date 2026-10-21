# CLM-0658 — XR-8.3a: تثبيتُ تطبيقِ الزبونِ من المتصفّح، وتخطيطُ الحاسوب

**التاريخ:** 2026-10-21 · **البند:** M0-54 (XR-8.3، الجزء أ) · **القرار:** [ADR-077](../../../15-decisions/ADR-077-multichannel-one-account-three-apps.md) D3

## المرجع

معيار التثبيت في Chrome: manifest فيه `name` أو `short_name`، وأيقونتان 192 و512، و`start_url`، و`display` من `fullscreen`/`standalone`/`minimal-ui`/`window-controls-overlay`، ولم يعد عامل الخدمة (service worker) شرطًا للتثبيت من القائمة (https://developer.chrome.com/blog/update-install-criteria ، https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).

## التغيير

- `apps/customer-mini-app/public/manifest.webmanifest`: الاسم «وَصْلة»، `lang: ar`، `dir: rtl`، `display: standalone`، أيقونتان 192 و512.
- `public/icons/`: `icon-192.png` و`icon-512.png` و`apple-touch-icon.png` (180). **مؤقتة**: حرف «و» أبيض على `#0066cc` بخط Noto Naskh Arabic، حتى قرار المالك في العلامة (OD-XR-7).
- `index.html`: `meta charset` أولًا، ثم سكربت تيليجرام، ثم `theme-color` ورابط manifest والأيقونات.
- `src/index.css`: من 768px فأعلى، عمود واحد بعرض أقصاه 720px في الوسط. الجوال وتيليجرام لا يتغيران.
- `e2e/frontend-quality.spec.ts`: اختباران جديدان (manifest ومعيار Chrome وأبعاد كل أيقونة من ترويسة PNG؛ وعمود الحاسوب عند 1280px بلا تمرير أفقي).

## ما قيس

| القياس | النتيجة | الملف |
|---|---|---|
| Playwright (الحزمة المبنية) | 39/39 (37 + 2) | `raw/playwright-e2e.txt` |
| خرق مزروع: حذف قاعدة الحاسوب من CSS | اختبار الحاسوب سقط: `Expected: <= 720 · Received: 1280` | `raw/planted-breach-no-desktop-css.txt` |
| لقطة 1280×800 | عمود في الوسط | `raw/desktop-1280.png` |
| vitest | 141/141 دون تغيير | `raw/vitest.txt` |

## ما لم يُقس ولم يُغلق

- لم يُجرَّب التثبيت الفعلي في Chrome على جهاز (Playwright يتحقق من المعيار لا من نافذة التثبيت).
- لا عامل خدمة ولا عمل دون اتصال بعد: التطبيق يتعامل مع رموز جلسة ونداءات API، وتخزينها المؤقت يحتاج تصميمًا مستقلًا.
- **XR-8.3 لم يُغلق:** شرط إغلاقه اختبار طرف إلى طرف في متصفح يشمل الدخول، والدخول من المتصفح ينتظر XR-8.5 في CORE (B-45).
