/**
 * `host/index.ts` — اكتشافُ المضيفِ وتحويلُ إثباتِه إلى طلبِ جلسة (XR-8.2).
 */

import { browserHost } from "./browser";
import { readTelegramWebApp, telegramHost } from "./telegram";
import { exchangeMiniAppInitDataAtCore, currentWebCredential, miniAppBridgeConfigured } from "./web-login";
import type { Host, SessionCredential, SessionRequest } from "./types";

export type { Host, HostKind, SessionCredential, SessionRequest } from "./types";
export {
  beginTelegramWebLogin,
  clearWebCredential,
  currentWebCredential,
  exchangeMiniAppInitDataAtCore,
  miniAppBridgeConfigured,
  webLoginConfigured,
} from "./web-login";

/**
 * يُكتشَفُ في كلِّ نداءٍ لا مرّةً واحدة: الكائنُ قد يظهرُ بعدَ التحميل، والاختبارُ
 * يبدّلُه بين الحالات. تيليجرام لا يُعتمَدُ إلا بـ`initData` غيرِ فارغة.
 */
export function detectHost(): Host {
  const webApp = readTelegramWebApp();
  if (webApp && webApp.initData) return telegramHost(webApp);
  return browserHost;
}

/** كلُّ نوعِ إثباتٍ له مسارُه وجسمُه عندَ الحدّ. */
export function sessionRequest(credential: SessionCredential): SessionRequest {
  switch (credential.kind) {
    case "telegram_init_data":
      return { path: "/edge/session", body: { init_data: credential.value } };
    case "web_core_session":
      // جسرُ XR-6.1: جلسةُ النواةِ تُستبدَلُ بجلسةِ سوقٍ — لا يمرُّ initData
      // المصغّرُ في الويبِ أصلًا، والتحققُّ من النواةِ عندَ مُصدِرِهِا في الحدّ.
      return { path: "/edge/session/web", body: { core_access_token: credential.value } };
  }
}

/**
 * نتيجةُ صعودِ الإثباتِ إلى إثباتِ نواةٍ (جسرُ المصغّرِ · CLM-0703).
 *
 * - `"unconfigured"` — لا نواةَ موصولةً في هذهِ البيئةِ: المسارُ القديمُ
 *   صريحٌ، لا فشلٌ ولا تراجعٌ.
 * - `"rejected"` — الجسرُ مُهيّأٌ وفشلَ التبادلُ: فشلٌ ظاهرٌ لا يُسقِطُهُ
 *   تراجعٌ صامتٌ إلى المسارِ القديمِ (لا يُستبدَلُ دليلٌ مرفوضٌ بدليلٍ لا
 *   يُتحقَّقُ منهِ عندَ النواةِ).
 * - `SessionCredential` — إثباتُ نواةٍ جاهزٌ للاستبدالِ عندَ الحدّ.
 */
export type CoreSessionExchange =
  | "unconfigured"
  | "rejected"
  | { readonly credential: SessionCredential };

/**
 * يصعدُ إثباتَ المضيفِ إلى إثباتِ نواةٍ حينَ الجسرُ مُهيّأٌ (جسرُ المصغّرِ):
 * دليلُ المصغّرِ يُتبادلُ عندَ النواةِ فيصيرُ إثباتَ نواةٍ في الذاكرةِ — نفسُ
 * خانةِ الويبِ — ثمّ يُستبدلُ عندَ الحدِّ بجلسةِ السوقِ كما في الويبِ تمامًا.
 * إثباتُ الويبِ جاهزٌ أصلًا فيُعادُ كما هو.
 */
export async function exchangeForCoreSession(
  credential: SessionCredential,
): Promise<CoreSessionExchange> {
  if (credential.kind === "web_core_session") return { credential };
  if (!miniAppBridgeConfigured()) return "unconfigured";
  const exchanged = await exchangeMiniAppInitDataAtCore(credential.value);
  if (!exchanged) return "rejected";
  // الرمزُ خُزِنَ في خانةِ إثباتِ النواةِ — يُقرأُ منها لا يُمرَّرُ حرفيًّا.
  const bridged = currentWebCredential();
  return bridged === null ? "rejected" : { credential: bridged };
}
