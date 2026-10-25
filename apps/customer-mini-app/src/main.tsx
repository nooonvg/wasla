import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { useSessionStore } from "./store/session";
import { startSessionLifecycle } from "./session/session-init";
import { registerServiceWorker } from "./pwa/register-service-worker";
import { setWebCredentialForE2E } from "./host/web-login";
import "./i18n";
import "./index.css";

// ADR-069 · CLM-0524 (المرحلة 2 الجزء 2): تهيئةُ الجلسةِ من إثباتِ المضيفِ (`src/host/` · XR-8.2)
// في زمنِ التشغيلِ لا خلفَ خطافِ E2E وحدهُ — الشاشةُ «جارٍ التحميل» لم تعد نهائيةً
// في الإنتاجِ. لا تُخزَّنُ الجلسةُ في أيِّ تخزينٍ محليٍّ (ADR-044 §4).
// G-S8 (CLM-0610): تهيئةٌ أولى + إعادةٌ محدودةٌ عندَ الانتهاءِ/401.
startSessionLifecycle();

// XR-8.3 (المراجعة 6 · CLM-0665): تسجيلُ عاملِ الخدمةِ للقشرةِ القابلةِ للتثبيتِ
// (PWA) على الحاسوبِ والجوالِ من المتصفحِ — إنتاجٌ ومتصفحٌ فقط، وبلا عاملِ
// خدمةٍ في اختباراتِ Playwright ولا داخلَ تيليجرام (انظر pwa/register-service-worker.ts).
registerServiceWorker({ e2e: import.meta.env.VITE_E2E === "true" });

// E2E test support — compile-time gated, tree-shaken in production.
// When VITE_E2E is not set, this entire block is removed by the bundler.
// Provides session seeding for Playwright tests without a production backdoor.
if (import.meta.env.VITE_E2E === "true") {
  // Seed session from page init script if provided (for authenticated tests)
  const e2eSession = (
    window as unknown as {
      __waslaE2ESession?: {
        token: string;
        customerId: string;
        expiresAt: number;
      };
    }
  ).__waslaE2ESession;
  if (e2eSession) {
    useSessionStore.getState().setSession(
      e2eSession.token,
      e2eSession.customerId,
      e2eSession.expiresAt
    );
  }
  // CLM-0699: بذرُ إثباتِ النواةِ (دخولُ الويبِ) لرحلةِ الحذفِ — كما الجلسةُ،
  // لا بابٌ خلفيٌّ: البناءُ الإنتاجيُّ يُسقِطُ الكتلةَ كلَّها (VITE_E2E).
  const e2eWebCredential = (
    window as unknown as { __waslaE2EWebCredential?: string }
  ).__waslaE2EWebCredential;
  if (e2eWebCredential) {
    setWebCredentialForE2E(e2eWebCredential);
  }
  // Expose runtime controls for E2E tests
  (
    window as unknown as { __waslaE2E?: unknown }
  ).__waslaE2E = {
    setSession: (token: string, customerId: string, expiresAt: number) =>
      useSessionStore.getState().setSession(token, customerId, expiresAt),
    clearSession: () => useSessionStore.getState().clearSession(),
    setWebCredential: (token: string | null) => setWebCredentialForE2E(token),
  };
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
