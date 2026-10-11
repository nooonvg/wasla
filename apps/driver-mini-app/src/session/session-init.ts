/**
 * `session-init.ts` — تهيئةُ الجلسةِ من `Telegram.WebApp.initData` (ADR-069 §2.1).
 *
 * **لماذا ملفٌّ منفصلٌ لا تعديلٌ في `main.tsx`؟** التهيئةُ ليست ترتيبَ استيرادٍ
 * بل ترتيبَ تشغيلٍ — تُستدعى من `main.tsx` لا تُدرَجُ فيه. وهذا يسمحُ
 * للاختبارِ أن يستدعيَها بلا إقلاعِ التطبيقِ كاملًا.
 *
 * **لا تُخزَّنُ الجلسةُ في أيِّ تخزينٍ محليٍّ:** الرمزُ في الذاكرةِ وحدها
 * (ADR-045 §4 · ADR-019 §2.5)، وإعادةُ التحميلِ تُعيدُ التهيئةَ من `initData`.
 *
 * **لا يُستهلُّ التطبيقُ بلا جلسةٍ في الإنتاجِ:** الشاشةُ «جارٍ التحميل»
 * لا تُختبرُ هنا (اختبارُ UI) — يُختبرُ هنا العقدُ: يُرسلُ `initData` إلى
 * الحدِّ ويُستقبلُ رمزًا معتمًا، ولا يُقبلُ إلا من `WebApp` مُهيَّأٍ.
 */

import { useSessionStore } from "../store/session";

/** `Telegram.WebApp` كما يراه الحدُّ — لا يُقرأُ إلا بعدَ `ready()`. */
interface TelegramWebApp {
  readonly initData: string;
  ready(): void;
}

/** يُقرأُ `Telegram.WebApp` من النافذةِ لا من أيِّ مصدرٍ آخر. */
function readWebApp(): TelegramWebApp | null {
  const w = window as unknown as { Telegram?: { WebApp?: TelegramWebApp } };
  return w.Telegram?.WebApp ?? null;
}

/** ردُّ الحدِّ على `POST /edge/session` — لا يحملُ إلا ما يُخزَّنُ في الذاكرةِ. */
interface EdgeSessionResponse {
  readonly token: string;
  readonly wasla_public_id: string;
  readonly expires_at: string;
  readonly session_id: string;
}

/** خطأُ الحدِّ — لا يحملُ رمزًا ولا بصمةَ ولا سرًّا. */
interface EdgeError {
  readonly code: string;
  readonly message: string;
}

/**
 * تهيئةُ الجلسةِ من `Telegram.WebApp.initData` عبرَ حدِّ القناةِ.
 *
 * **لا يُعيدُ الرمزَ ولا يُخزِّنُهُ في أيِّ مكانٍ غيرِ الذاكرةِ.** ويُرجعُ
 * `true` عندَ النجاحِ و`false` عندَ أيِّ فشلٍ (لا يرفعُ — الشاشةُ تعالجُ).
 */
export async function initSessionFromTelegram(): Promise<boolean> {
  const webApp = readWebApp();
  if (!webApp || !webApp.initData) {
    // لا يُستهلُّ التطبيقُ من خارجِ تلغرامَ في هذهِ المرحلةِ — الشاشةُ
    // «جارٍ التحميل» تبقى كما هي (لا اختراعَ مصدرِ جلسةٍ ثانٍ).
    return false;
  }
  webApp.ready();
  const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/edge/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ init_data: webApp.initData }),
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as EdgeError;
    console.warn("[session-init] فشل إصدار الجلسة:", error.code ?? response.status);
    return false;
  }
  const body = (await response.json()) as EdgeSessionResponse;
  const expiresAtMs = Date.parse(body.expires_at);
  if (!Number.isFinite(expiresAtMs)) {
    return false;
  }
  useSessionStore
    .getState()
    .setSession(body.token, body.wasla_public_id, expiresAtMs);
  return true;
}

/** سحبُ الجلسةِ عبرَ `POST /edge/session/logout` — لا يُخزَّنُ شيءٌ هنا. */
export async function logoutSession(): Promise<void> {
  const { token, clearSession } = useSessionStore.getState();
  if (!token) return;
  const baseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
  await fetch(`${baseUrl}/edge/session/logout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  }).catch(() => undefined);
  clearSession();
}
