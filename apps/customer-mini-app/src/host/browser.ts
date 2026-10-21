/**
 * `host/browser.ts` — المتصفّحُ العاديُّ (حاسوبٌ أو جوال) (XR-8.2).
 *
 * لا إثباتَ هويّةٍ مبنيٌّ له بعدُ: دخولُ الويبِ محوّلٌ في CORE (XR-8.5 · B-45)
 * لم يُبنَ، و`services/identity` هنا مجمَّدةٌ (ADR-076 D4). فالجلسةُ تفشلُ
 * بسببٍ ظاهرٍ بدلَ أن يُختَرَعَ مصدرُ جلسةٍ ثانٍ.
 */

import type { Host } from "./types";

export const browserHost: Host = {
  kind: "browser",
  ready: () => undefined,
  sessionCredential: () => null,
};
