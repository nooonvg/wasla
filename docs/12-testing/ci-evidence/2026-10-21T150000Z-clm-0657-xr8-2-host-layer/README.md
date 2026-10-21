# CLM-0657 — XR-8.2: طبقةُ المضيفِ في `customer-mini-app`

**التاريخ:** 2026-10-21 · **البند:** M0-54 (XR-8.2 من الخارطة المشتركة Revision 2) · **القرار:** [ADR-077](../../../15-decisions/ADR-077-multichannel-one-account-three-apps.md) D3

## ما قيس قبل التغيير (`main` عند `fc1d08f`)

1. `apps/customer-mini-app/src/session/session-init.ts` يقرأ `window.Telegram.WebApp` مباشرة.
2. **لا يوجد سكربت `telegram-web-app.js` في أي ملف من المستودع** (`rg telegram-web-app` فارغ، و`git log -S telegram-web-app` فارغ). وثيقة تيليجرام الرسمية (https://core.telegram.org/bots/webapps) تشترط: «To connect your Mini App to the Telegram client, place the script telegram-web-app.js in the `<head>` tag before any other scripts». الموقع الثابت يُبنى من `apps/customer-mini-app/index.html` كما هو (`infra/terraform/apps/main.tf`، `publish_path = apps/customer-mini-app/dist`). النتيجة المستنتجة: داخل تيليجرام لا يُعرَّف `Telegram.WebApp`، فتفشل الجلسة بـ`not_in_telegram` دائمًا. **لم يُقس داخل تطبيق تيليجرام حقيقي** (لا نشر ولا T1 حي — ADR-073)، فهو استنتاج من الوثيقة والشيفرة لا قياس ميداني.
3. اختبارات الوحدة 131/131 ناجحة.

## التغيير

- `src/host/` (جديد): `types.ts` (عقد المضيف)، `telegram.ts` (الملف الوحيد الذي يقرأ `window.Telegram`)، `browser.ts` (متصفح بلا إثبات هوية حتى XR-8.5)، `index.ts` (`detectHost` و`sessionRequest`).
- `session-init.ts`: لا يقرأ أي كائن منصة؛ يأخذ المضيف وإثباته وطلبه من `../host`. عقد الحد لم يتغير (`POST /edge/session` بـ`{ init_data }`). `initSessionFromTelegram` صار `initSession`.
- `index.html`: سكربت تيليجرام الرسمي في `<head>` قبل أي سكربت آخر.
- اختبار «حدود المضيف» داخل `src/__tests__/session-init.test.ts`: يقرأ كل ملفات الإنتاج في `src/` (بلا الاختبارات وبلا `src/host/`) بعد إزالة التعليقات والنصوص، ويفشل إن ظهر `Telegram` أو `WebApp` أو `initData` أو `init_data` أو `DiscordSDK` أو `Capacitor`. الحد المعلن: الوصول عبر نص محسوب لا يُرى.
- `e2e/helpers.ts` (`stubTelegramSdk`) و`e2e/auth-session.spec.ts`: الاختبار يخدم بديلًا لسكربت تيليجرام بدل حقن الكائن، لأن السكربت الحقيقي صار يُحمَّل بعد الحقن ويستبدله.

## ما قيس بعد التغيير

| القياس | النتيجة | الملف الخام |
|---|---|---|
| `tsc --noEmit` | نظيف | — |
| `vitest run` | 141/141 (131 + 10 جديدة) | `raw/vitest-customer-mini-app.txt` |
| خرق مزروع: سطر `window.Telegram` في `src/App.tsx` | الحارس سقط بـ`['../App.tsx']` ثم أُعيد الملف | `raw/planted-breach.txt` |
| `playwright test` (Pixel 5، الحزمة المبنية) | 37/37 بعد تعديل الاختبار؛ قبل التعديل 36/37 والساقط هو الحقن الذي يستبدله السكربت الحقيقي | `raw/playwright-e2e.txt` |
| السكربت الحقيقي في متصفح خارج تيليجرام | `200 https://telegram.org/js/telegram-web-app.js?64`، `Telegram.WebApp` معرَّف، `initData = ""`، `platform = "unknown"`، `version = "6.0"` ⇒ مضيف متصفح، وتظهر رسالة «افتح التطبيق من تلغرام» | `raw/real-sdk-outside-telegram.txt` |

## ما لم يُقس

- التشغيل داخل تطبيق تيليجرام حقيقي (يحتاج نشرًا وبوتًا حيًا — قرار مالك).
- سلوك السكربت إن تعذر الوصول إلى `telegram.org` (الصفحة تكمل لأن فشل سكربت كلاسيكي لا يوقف السكربت الوحدوي، لكن لم يُقس زمن التأخير).
