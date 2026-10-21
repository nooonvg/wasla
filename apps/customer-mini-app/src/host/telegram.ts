/**
 * `host/telegram.ts` — مضيفُ تيليجرام ميني آب. الملفُّ الوحيدُ الذي يقرأُ
 * `window.Telegram` (XR-8.2).
 *
 * الكائنُ يُعرِّفُه سكربتُ تيليجرام الرسميُّ المحمَّلُ في `<head>` من
 * `index.html` (https://core.telegram.org/bots/webapps: «place the script
 * telegram-web-app.js in the <head> tag before any other scripts»). خارجَ
 * تيليجرام يُعرَّفُ الكائنُ و`initData` فارغة، فيُعامَلُ المضيفُ متصفّحًا.
 */

import type { Host } from "./types";

interface TelegramWebApp {
  readonly initData: string;
  ready(): void;
}

/** يُقرأُ من النافذةِ لا من أيِّ مصدرٍ آخر. */
export function readTelegramWebApp(): TelegramWebApp | null {
  const w = window as unknown as { Telegram?: { WebApp?: TelegramWebApp } };
  return w.Telegram?.WebApp ?? null;
}

export function telegramHost(webApp: TelegramWebApp): Host {
  return {
    kind: "telegram",
    ready: () => webApp.ready(),
    sessionCredential: () =>
      webApp.initData ? { kind: "telegram_init_data", value: webApp.initData } : null,
  };
}
