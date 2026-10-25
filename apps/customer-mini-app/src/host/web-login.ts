/**
 * `host/web-login.ts` — دخولُ الويبِ عبرَ تيليجرام (XR-8.5 · B-45) — الجزءُ
 * التطبيقيُّ من مضيفِ المتصفّحِ داخلَ `src/host/` لأنَّ مكتبةَ دخولِ تيليجرامِ
 * كائنٌ خاصٌّ بمنصّةٍ لا يقرؤهُ سوى هذا المجلّدِ (حارسُ حدودِ المضيفِ).
 *
 * **التدفقُ (عقدُ النواةِ كما بُنيَ في F-42):**
 *   1. `POST /v1/web-session/telegram/nonce` عندَ النواةِ — يفتحُ المحاولةَ
 *      (nonce في الجسمِ + كوكيُّ `wasla_web_attempt` HttpOnly يرفقُهُ المتصفّحُ
 *      تلقائيًّا معَ الطلبِ التاليِ ولا يقرؤهُ سكربتٌ).
 *   2. نافذةُ دخولِ تيليجرامِ الرسميّةِ (`telegram-login.js`) — الرمزُ يعودُ
 *      وفيهِ `nonce` محاولتِنا (ربطُ المحاولةِ بمتصفّحِنا).
 *   3. `POST /v1/web-session/telegram` بِالرمزِ — تتحقّقُ النواةُ من توقيعِ
 *      RS256 ضدَّ مفاتيحِ تيليجرامِ العلنيّةِ ومن nonce والكوكي، وتُصدرُ
 *      جلسةَ نواةٍ (access_token).
 *   4. الرمزُ في **الذاكرةِ وحدَها** (ADR-044 §4 — لا تخزينَ محليًّا)،
 *      ويعودُ بهِ `browserHost.sessionCredential()` فيُستبدَلُ عندَ الحدِّ
 *      بجلسةِ سوقٍ (`POST /edge/session/web` — XR-6.1).
 *
 * **لا تُختلَطُ بالتحققِّ من `initData` المصغّرِ:** التحققُّ من مزوّدِ الهويّةِ
 * (التوقيعُ والمُصدِرُ والجمهورُ والصلاحيّةُ) كلُّهُ في النواةِ، لا هنا.
 */

import type { SessionCredential } from "./types";

/** عنوانُ النواةِ — يُضبطُ بنشرِ النواةِ (قرارُ البيئةِ). يُقرأُ عندَ الاستدعاءِ لا عندَ الإقلاعِ — فالاختبارُ يبدّلُه. */
export function coreBaseUrl(): string {
  return (import.meta.env.VITE_CORE_URL ?? "").replace(/\/$/, "");
}

/** مُعرّفُ عميلِ تيليجرامِ (الرقمُ الرقميُّ للبوتِ) — من @BotFather. */
function telegramClientId(): number {
  const parsed = Number(import.meta.env.VITE_TELEGRAM_CLIENT_ID ?? "0");
  // قيمةٌ غيرُ رقميّةٍ (NaN) ليست "مُعرّفًا" — الدخولُ بلا مُعرّفٍ بوتٍ غيرُ مُهيّأٍ.
  return Number.isFinite(parsed) ? parsed : 0;
}

/** رمزُ جلسةِ النواةِ — في الذاكرةِ وحدَها، يُعادُ فتحُهُ بكلِّ تحميلٍ. */
let coreAccessToken: string | null = null;

/** ما تُصدِرُهُ النواةُ عندَ فتحِ المحاولةِ. */
interface NonceResponse {
  readonly nonce: string;
  readonly expires_at: string;
}

/** ما تُصدِرُهُ النواةُ عندَ إتمامِ الدخولِ. */
interface CoreSessionResponse {
  readonly session_id: string;
  readonly access_token: string;
  readonly token_type: string;
  readonly expires_at: string;
  readonly identity_id: string;
  readonly identity_created: boolean;
}

/** حمولةُ نداءِ مكتبةِ تيليجرامِ — نجاحٌ أو خطأٌ مسمًّى. */
interface TelegramLoginResult {
  readonly id_token?: string;
  readonly error?: string;
}

/** عقدُ مكتبةِ `telegram-login.js` الرسميّةِ (الجزءُ المستخدَمُ وحدَهُ). */
interface TelegramLoginLibrary {
  auth(
    options: {
      client_id: number;
      nonce?: string;
      scope?: string[];
      lang?: string;
    },
    callback: (result: TelegramLoginResult) => void,
  ): void;
}

/** هل دخولُ الويبِ مُهيّأٌ في هذهِ البيئةِ؟ (عنوانُ النواةِ ومُعرّفُ البوتِ) */
export function webLoginConfigured(): boolean {
  return coreBaseUrl() !== "" && telegramClientId() !== 0;
}

/** إثباتُ الويبِ الحاليُّ — أو `null` ما لم يُكمَلِ الدخولُ بعدُ. */
export function currentWebCredential(): SessionCredential | null {
  return coreAccessToken === null ? null : { kind: "web_core_session", value: coreAccessToken };
}

/** مسحُ الجلسةِ في الذاكرةِ (الخروجُ). */
export function clearWebCredential(): void {
  coreAccessToken = null;
}

/**
 * بذرُ إثباتِ النواةِ لاختباراتِ E2E والوحدةِ — لا أثرَ لهُ في الإنتاجِ:
 * يُسقِطُهُ البناءُ (MODE=production) أو يُعطِّلُهُ (لا يعملُ في الإقلاعِ).
 * الدافعُ (CLM-0699): رحلةُ حذفِ الحسابِ في E2E تبدأُ بدخولِ ويبٍ مُكمَّلٍ،
 * وتيليجرامُ OIDC نفسُهُ لا يُحاكى — فيُبذَرُ الرمزُ كما تُبذَرُ الجلسةُ
 * عبرَ `__waslaE2ESession` (لا بابٌ خلفيٌّ في الإنتاجِ: مجمَّعٌ شرطيًّا).
 */
export function setWebCredentialForE2E(token: string | null): void {
  if (import.meta.env.VITE_E2E !== "true") return;
  coreAccessToken = token;
}

/**
 * تحميلُ مكتبةِ تيليجرامِ ديناميكيًّا عندَ الحاجةِ لا عندَ الإقلاعِ — الملفُّ
 * الوحيدُ الذي يقرأُ كائنَ `Telegram.Login` (حدودُ المضيفِ).
 */
async function loadTelegramLoginLibrary(): Promise<TelegramLoginLibrary | null> {
  const w = window as unknown as { Telegram?: { Login?: TelegramLoginLibrary } };
  if (w.Telegram?.Login !== undefined) return w.Telegram.Login;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://oauth.telegram.org/js/telegram-login.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("telegram-login.js load failed"));
    document.head.appendChild(script);
  });
  return (window as unknown as { Telegram?: { Login?: TelegramLoginLibrary } }).Telegram?.Login ?? null;
}

/**
 * الدخولُ الكاملُ بالويبِ — يُرجعُ `true` عندَ نجاحِ الجلسةِ (والرمزُ في
 * الذاكرةِ)، و`false` عندَ أيِّ فشلٍ (لا يرفعُ). لا يُخزَّنُ الرمزُ في أيِّ
 * تخزينٍ محليٍّ — إعادةُ التحميلِ تعيدُ الدخولَ من أوّلِهِ.
 */
export async function beginTelegramWebLogin(): Promise<boolean> {
  if (!webLoginConfigured()) return false;
  try {
    // وحدةُ نقلٍ مُعلَنةٌ (APP_API_ROUTES §3): العميلُ الذي يُركّبُ `${baseUrl}${path}`.
    const baseUrl = coreBaseUrl();
    // 1) فتحُ المحاولةِ عندَ النواةِ — الكوكيُّ HttpOnly يُرفَقُ بالمتصفّحِ.
    const nonceResponse = await fetch(`${baseUrl}/v1/web-session/telegram/nonce`, {
      method: "POST",
      credentials: "include",
    });
    if (!nonceResponse.ok) return false;
    const { nonce } = (await nonceResponse.json()) as NonceResponse;

    // 2) نافذةُ تيليجرامِ — الرمزُ يعودُ وفيهِ nonce محاولتِنا.
    const login = await loadTelegramLoginLibrary();
    if (login === null) return false;
    const idToken = await new Promise<string | null>((resolve) => {
      login.auth({ client_id: telegramClientId(), nonce, scope: ["profile"] }, (result) => {
        resolve(result.id_token ?? null);
      });
    });
    if (idToken === null) return false;

    // 3) إتمامُ الدخولِ عندَ النواةِ — الكوكيُّ يُرفَقُ تلقائيًّا.
    const sessionResponse = await fetch(`${baseUrl}/v1/web-session/telegram`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_token: idToken }),
    });
    if (!sessionResponse.ok) return false;
    const session = (await sessionResponse.json()) as CoreSessionResponse;
    coreAccessToken = session.access_token;
    return true;
  } catch {
    // فشلُ شبكةٍ أو تحميلِ المكتبةِ — ظاهرٌ بـ`false` لا برفعٍ يُسقِطُ التطبيقَ.
    return false;
  }
}
