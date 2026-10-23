/**
 * `host/types.ts` — عقدُ المضيفِ الذي يعملُ فيه التطبيق (XR-8.2 · ADR-077 D3).
 *
 * التطبيقُ نفسُه قاعدةُ شيفرةٍ واحدةٌ على كلِّ القنوات؛ وما يختلفُ بين تيليجرام
 * والمتصفّحِ (ثمّ ديسكورد والغلافِ الأصليِّ في XR-8.4 وXR-8.7) يعيشُ هنا وحدَه.
 * لا يقرأُ أيُّ ملفٍّ خارجَ `src/host/` كائنًا خاصًّا بمنصّة — يفرضُ ذلك
 * اختبارُ «حدود المضيف» في `__tests__/session-init.test.ts`.
 */

/** المضيفاتُ المبنيّةُ اليوم. تُضافُ `discord` و`native` حينَ تُبنى، لا قبلَها. */
export type HostKind = "telegram" | "browser";

/**
 * ما يُثبِتُ به المضيفُ هويّةَ المستخدمِ للحدّ. نوعانِ اليوم: إثباتُ تيليجرامِ
 * المصغّرِ (initData)، وإثباتُ الويبِ — جلسةُ نواةٍ مُصدَرةٌ من دخولِ تيليجرامِ
 * OIDC (XR-8.5 · B-45) تُستبدَلُ عندَ الحدِّ بجلسةِ سوقٍ عبرَ `/edge/session/web`.
 */
export type SessionCredential =
  | { readonly kind: "telegram_init_data"; readonly value: string }
  | { readonly kind: "web_core_session"; readonly value: string };

/** طلبُ إصدارِ الجلسةِ كما يرسلُه التطبيقُ إلى الحدّ. */
export interface SessionRequest {
  readonly path: string;
  readonly body: Readonly<Record<string, string>>;
}

export interface Host {
  readonly kind: HostKind;
  /** يُبلِغُ المنصّةَ أنّ الواجهةَ جاهزة (لا شيءَ في المتصفّح). */
  ready(): void;
  /** إثباتُ الهويّةِ من المضيف، أو `null` إن لم يكن له إثباتٌ مبنيّ. */
  sessionCredential(): SessionCredential | null;
}
