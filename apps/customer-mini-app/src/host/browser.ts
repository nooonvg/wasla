/**
 * `host/browser.ts` — المتصفّحُ العاديُّ (حاسوبٌ أو جوال) (XR-8.2 · XR-8.5).
 *
 * إثباتُهُ الآنَ مُبنٍ: دخولُ تيليجرامِ OIDC عبرَ النواةِ (`./web-login`) يُصدرُ
 * جلسةَ نواةٍ في الذاكرةِ، ويعودُ بها هذا المضيفُ فتُستبدَلُ عندَ الحدِّ
 * بجلسةِ سوقٍ. قبلَ الدخولِ — أو في بيئةٍ بلا نواةٍ مُهيّأةٍ — يعودُ `null`
 * فتُعلِنُ التهيئةُ حاجتَها للدخولِ (`web_login_required`) لا خطأً نهائيًّا.
 */

import { currentWebCredential } from "./web-login";
import type { Host } from "./types";

export const browserHost: Host = {
  kind: "browser",
  ready: () => undefined,
  sessionCredential: currentWebCredential,
};
