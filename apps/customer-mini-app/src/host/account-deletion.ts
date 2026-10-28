/**
 * حذفُ الحسابِ من النواةِ (D-XR-13 · XR-8.3 · wasla-core PR #23) — وحدةُ نقلٍ
 * محايدةٌ للمضيفِ لا تعرفُ منصةً ولا مكتبةَ واجهةٍ، كما كلُّ ملفٍّ في `src/host/`
 * (XR-8.2): هذا الملفُّ هو الوجهُ الوحيدُ الذي تراهُ الشاشاتُ، والطلباتُ
 * إلى النواةِ تُجمَّعُ هنا وحدَها وتُسجَّلُ في `APP_API_ROUTES.md` §3
 * (نمطُ CLM-0679).
 *
 * **لماذا نداءٌ مباشرٌ إلى النواةِ؟** الحذفُ فعلُ الشخصِ نفسِهِ: النواةُ ترفضُ
 * حذفَ حسابٍ بجلسةِ خدمةٍ (403 — «من ينوبُ عنهُ يجبُ أن يطلبَ»)، فلا يمكنُ
 * للحدِّ أن ينوبَ. وإثباتُ الويبِ (XR-8.5) هو الجلسةُ التي يملكُها الشخصُ
 * عندَ النواةِ — تُحفَظُ في الذاكرةِ وحدَها في `web-login.ts` — وبهِ يُطلَبُ
 * `POST /v1/me/deletion` من النواةِ مباشرةً، كما يُطلَبُ دخلُ الويبِ نفسُه.
 *
 * **جسرُ المصغّرِ (CLM-0703):** الحذفُ كانَ حدًّا معلَنًا لحاملي إثباتِ الويبِ
 * وحدهم (D-XR-13) — مستعملُ المصغّرِ يُرشَدُ إلى نسخةِ الويبِ. الآنَ دليلُ
 * المصغّرِ نفسُهُ يُتبادلُ عندَ النواةِ (جسرُ CLM-0703) فيُخزَّنُ في نفسِ
 * خانةِ إثباتِ الويبِ — فالحذفُ متاحٌ في المصغّرِ والويبِ لمن أكملَ التهيئةَ
 * بجسرٍ موصولٍ (VITE_CORE_URL). بلا جسرٍ ولا إثباتٍ ويبٍ: الإرشادُ كما هو.
 * القناةُ نفسُها وجهانِ لشخصٍ واحدٍ عندَ النواةِ (tg-<معرّف>)، والجيلُ
 * بعدَ الحذفِ يُحسَمُ بربطِ CLM-0701 (الذي يصلهُ identity_id الآنَ في
 * تركيبِ الحدِّ — إصلاحُ هذهِ الدورةِ).
 *
 * **لا يُخزَّنُ شيءٌ هنا:** الرمزُ في `web-login.ts` في الذاكرةِ، والنتيجةُ
 * تُعادِ الحالةُ إلى الشاشةِ لتقرّرَ ما بعدها (الوداعُ ومسحُ الجلساتِ).
 */
import { clearWebCredential, currentWebCredential, coreBaseUrl } from "./web-login";

/** ما يمكنُ أن يجيبَ بهِ `POST /v1/me/deletion` — لا يُسَلَّمُ شيءٌ من الجسمِ. */
export type AccountDeletionOutcome =
  /** 204 — انتهى: الهويةُ مُقبَرةٌ وكلُّ الجلساتِ سُحبت. */
  | { status: "deleted" }
  /** 409 — مديرٌ نشطٌ: تُسمّى المنظماتُ التي يجبُ نقلُها أو إغلاقُها أولًا. */
  | { status: "refused_admin"; organizationIds: readonly string[] }
  /** 401 — إثباتُ النواةِ ماتَ: انتهى أو حُذفَ سلفًا؛ لا فرقَ عندَ العميلِ. */
  | { status: "unauthenticated" }
  /** 403 — جسالةُ خدمةٍ: لا يحدثُ من هذا التطبيقِ، ويُعلَنُ لا يُبتلَعُ. */
  | { status: "forbidden" }
  /** لا إثباتَ ويبٍ في الذاكرةِ — الحذفُ من نسخةِ الويبِ (الحدُّ المعلَنُ). */
  | { status: "no_web_credential" }
  /** الشبكةُ سقطت قبلَ الجوابِ — إعادةُ المحاولةِ آمنةٌ (العقدُ غيرُ مُرَّدِدٍ). */
  | { status: "network" }
  /** جوابٌ غيرُ متوقَّعٍ — يُعلَنُ رقمُهُ لا يُصمَّتُ. */
  | { status: "unknown"; statusCode: number };

/** هل الحذفُ متاحٌ في هذه الجلسةِ؟ إثباتُ ويبٍ في الذاكرةِ + عنوانُ نواةٍ. */
export function accountDeletionAvailable(): boolean {
  return coreBaseUrl() !== "" && currentWebCredential() !== null;
}

/**
 * يطلبُ حذفَ الحسابِ من النواةِ بجلسةِ الشخصِ نفسِهِ (لا بديلَ عن 204).
 *
 * عندَ النجاحِ أو 401 يُمسَحُ إثباتُ النواةِ من الذاكرةِ فورًا: الجلسةُ ماتت
 * عندَ النواةِ في الحالتين، وتركُّها وهمًا صالحًا خطأٌ لا راحةٌ.
 */
export async function requestAccountDeletion(): Promise<AccountDeletionOutcome> {
  const credential = currentWebCredential();
  if (!credential) return { status: "no_web_credential" };
  const baseUrl = coreBaseUrl();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/v1/me/deletion`, {
      method: "POST",
      headers: { Authorization: `Bearer ${credential.value}` },
    });
  } catch {
    return { status: "network" };
  }
  if (response.status === 204) {
    clearWebCredential();
    return { status: "deleted" };
  }
  if (response.status === 409) {
    const body = (await response.json().catch(() => ({}))) as {
      details?: { organization_ids?: unknown };
    };
    const raw = body.details?.organization_ids;
    const organizationIds = Array.isArray(raw)
      ? raw.filter((id): id is string => typeof id === "string")
      : [];
    return { status: "refused_admin", organizationIds };
  }
  if (response.status === 401) {
    clearWebCredential();
    return { status: "unauthenticated" };
  }
  if (response.status === 403) return { status: "forbidden" };
  return { status: "unknown", statusCode: response.status };
}
