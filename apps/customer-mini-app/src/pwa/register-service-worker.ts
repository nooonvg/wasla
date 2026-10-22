/**
 * `pwa/register-service-worker.ts` — تسجيل عامل الخدمة (XR-8.3 · CLM-0665 · المراجعة 6).
 *
 * قيود التسجيل الأربعة، وكلٌّ منها مقيس باختبار:
 * 1. دعم المتصفح لواجهة عامل الخدمة (المتصفحات القديمة تعمل بلا عامل خدمة).
 * 2. بيئة الإنتاج وحدها (بناء Vite): التطوير لا يحتاج عامل خدمة.
 * 3. ليست بيئة اختبار Playwright (علم VITE_E2E): عامل الخدمة قد يبطئ الاختبارات
 *    أو يخدعها باستجابة مخزنة، فتُستثنى صراحةً.
 * 4. المضيف متصفحًا (خارج تيليجرام): عامل الخدمة داخل WebView تيليجرام بلا قيمة،
 *    والتطبيق المصغر يعمل في بيئة المضيف الأصلية.
 *
 * فشل التسجيل لا يُفشل التطبيق أبدًا: كل ما يفقده المستخدم هو القابلية للتثبيت
 * والعمل المحدود دون اتصال، والتطبيق صالح بلا عامل خدمة.
 */
import { detectHost } from "../host";

export interface ServiceWorkerEnv {
  /** بيئة إنتاج (بناء Vite) — تُمرَّر صراحةً لقابلية الاختبار. */
  prod?: boolean;
  /** علم بيئة اختبار Playwright (VITE_E2E). */
  e2e?: boolean;
}

export function registerServiceWorker(
  env: ServiceWorkerEnv = {},
): void {
  const prod = env.prod ?? import.meta.env.PROD; // المُسجَّل في سجلّ الإعداد (فحص 18، قراءة bag) — لا يُقرأ في غير هذا الملف.
  if (typeof navigator === "undefined") return;
  if (!navigator.serviceWorker) return;
  if (!prod) return;
  if (env.e2e) return;
  if (detectHost().kind !== "browser") return;
  void navigator.serviceWorker.register("/sw.js").catch(() => {
    // فشل التسجيل لا يوقف التطبيق — عامل الخدمة تحسين لا شرط صلاحية.
  });
}
