/**
 * `host/index.ts` — اكتشافُ المضيفِ وتحويلُ إثباتِه إلى طلبِ جلسة (XR-8.2).
 */

import { browserHost } from "./browser";
import { readTelegramWebApp, telegramHost } from "./telegram";
import type { Host, SessionCredential, SessionRequest } from "./types";

export type { Host, HostKind, SessionCredential, SessionRequest } from "./types";

/**
 * يُكتشَفُ في كلِّ نداءٍ لا مرّةً واحدة: الكائنُ قد يظهرُ بعدَ التحميل، والاختبارُ
 * يبدّلُه بين الحالات. تيليجرام لا يُعتمَدُ إلا بـ`initData` غيرِ فارغة.
 */
export function detectHost(): Host {
  const webApp = readTelegramWebApp();
  if (webApp && webApp.initData) return telegramHost(webApp);
  return browserHost;
}

/** كلُّ نوعِ إثباتٍ له مسارُه وجسمُه عندَ الحدّ — والحدُّ لا يقبلُ اليومَ إلا واحدًا. */
export function sessionRequest(credential: SessionCredential): SessionRequest {
  switch (credential.kind) {
    case "telegram_init_data":
      return { path: "/edge/session", body: { init_data: credential.value } };
  }
}
