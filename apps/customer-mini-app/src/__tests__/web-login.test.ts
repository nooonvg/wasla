/**
 * اختباراتُ `host/web-login.ts` — دخولُ الويبِ عبرَ تيليجرام (XR-8.5 · B-45).
 *
 * ما يُقاسُ هنا عقدُ النواةِ والجسرِ لا واجهةِ تيليجرامِ الحيّةِ: الطلبانِ
 * (`nonce` ثمّ `id_token`)، وربطُ الاثنينِ (الكوكيُّ HttpOnly لا يُقرأُهُ
 * سكربتٌ — يُرفَقُ تلقائيًّا)، ومكتبةُ تيليجرامِ مُزيَّفةٌ (لا شبكةَ في
 * الاختبارِ). والفشلُ يُبرَّنُ بالنفيِ: لا رمزَ يبقى في الذاكرةِ.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  beginTelegramWebLogin,
  clearWebCredential,
  currentWebCredential,
  exchangeMiniAppInitDataAtCore,
  miniAppBridgeConfigured,
  webLoginConfigured,
} from "../host/web-login";
import { browserHost } from "../host/browser";
import { sessionRequest } from "../host";

const CORE_URL = "https://core.test";
const CLIENT_ID = 123456789;
const NONCE = "nonce-abc-123";
const ID_TOKEN = "telegram-signed-id-token";
const CORE_TOKEN = "core-session-token";

/** استجابةُ فتحِ المحاولةِ. */
const nonceResponse = () =>
  new Response(JSON.stringify({ nonce: NONCE, expires_at: "2026-10-23T12:00:00Z" }), {
    status: 201,
    headers: { "Content-Type": "application/json" },
  });

/** استجابةُ إتمامِ الدخولِ. */
const sessionResponse = () =>
  new Response(
    JSON.stringify({
      session_id: "s-1",
      access_token: CORE_TOKEN,
      token_type: "Bearer",
      expires_at: "2026-10-23T13:00:00Z",
      identity_id: "i-1",
      identity_created: false,
    }),
    { status: 201, headers: { "Content-Type": "application/json" } },
  );

/** فحصُ الطلباتِ المُرسَلةِ فعليًّا — لا مجرَّدَ نجاحِ النداءِ. */
interface RecordedRequest {
  url: string;
  method: string;
  credentials?: RequestCredentials;
  body?: string;
}

let fetchMock: ReturnType<typeof vi.fn>;
let loginAuthMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("VITE_CORE_URL", CORE_URL);
  vi.stubEnv("VITE_TELEGRAM_CLIENT_ID", String(CLIENT_ID));
  clearWebCredential();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  // مكتبةُ تيليجرامِ مُزيَّفةٌ: نافذةٌ تُرجِعُ الرمزَ فورًا. الحقيقيّةُ تُحمَّلُ
  // من `oauth.telegram.org` — هنا يُعرَّفُ الكائنُ مسبقًا فلا يُحمَّلُ سكربتٌ.
  loginAuthMock = vi.fn();
  (window as unknown as { Telegram: unknown }).Telegram = {
    Login: {
      auth: loginAuthMock,
    },
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  delete (window as unknown as { Telegram?: unknown }).Telegram;
});

/** توجيهُ نداءَيِ النواةِ في المحاكاةِ: nonce ثمّ جلسة. */
function stubCoreFlow(): RecordedRequest[] {
  const recorded: RecordedRequest[] = [];
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    recorded.push({
      url,
      method: init?.method ?? "GET",
      credentials: init?.credentials,
      body: init?.body === undefined ? undefined : String(init.body),
    });
    if (url.endsWith("/v1/web-session/telegram/nonce")) return nonceResponse();
    if (url.endsWith("/v1/web-session/telegram")) return sessionResponse();
    throw new Error(`unexpected fetch: ${url}`);
  });
  return recorded;
}

describe("webLoginConfigured", () => {
  it("مُهيّأٌ بعنوانِ النواةِ ومُعرّفِ البوتِ", () => {
    expect(webLoginConfigured()).toBe(true);
  });

  it("غيرُ مُهيّأٍ بلا عنوانِ النواةِ — والدخولُ يعودُ بلا محاولةِ شبكةٍ", async () => {
    vi.stubEnv("VITE_CORE_URL", "");
    expect(webLoginConfigured()).toBe(false);
    expect(await beginTelegramWebLogin()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("غيرُ مُهيّأٍ بمُعرّفِ بوتٍ غيرِ رقميٍّ", () => {
    vi.stubEnv("VITE_TELEGRAM_CLIENT_ID", "not-a-number");
    expect(webLoginConfigured()).toBe(false);
  });
});

describe("currentWebCredential / browserHost", () => {
  it("قبلَ الدخولِ: لا إثباتَ — والمضيفُ يُعلِنُ حاجتَهُ للدخولِ (null)", () => {
    expect(currentWebCredential()).toBeNull();
    expect(browserHost.sessionCredential()).toBeNull();
  });

  it("بعدَ الدخولِ: إثباتُ النواةِ يعودُ من المضيفِ — والحدُّ يستبدلُهُ بجلسةِ سوقٍ", async () => {
    stubCoreFlow();
    loginAuthMock.mockImplementation((_options, callback) => {
      callback({ id_token: ID_TOKEN });
    });
    expect(await beginTelegramWebLogin()).toBe(true);
    expect(currentWebCredential()).toEqual({ kind: "web_core_session", value: CORE_TOKEN });
    expect(browserHost.sessionCredential()).toEqual({
      kind: "web_core_session",
      value: CORE_TOKEN,
    });
    // عقدُ الجسرِ (XR-6.1): الجسمُ `core_access_token` لا initData المصغّرِ.
    expect(sessionRequest(browserHost.sessionCredential()!)).toEqual({
      path: "/edge/session/web",
      body: { core_access_token: CORE_TOKEN },
    });
  });

  it("المسحُ يُعيدُ الحالةَ الأولى", async () => {
    stubCoreFlow();
    loginAuthMock.mockImplementation((_options, callback) => {
      callback({ id_token: ID_TOKEN });
    });
    await beginTelegramWebLogin();
    clearWebCredential();
    expect(currentWebCredential()).toBeNull();
  });
});

describe("beginTelegramWebLogin — العقدُ معَ النواةِ", () => {
  it("الطلبانِ كما في عقدِ النواةِ: nonce بلا جسمٍ ثمّ الرمزُ معَ الكوكي", async () => {
    const recorded = stubCoreFlow();
    loginAuthMock.mockImplementation((options, callback) => {
      // الرمزُ يعودُ وفيهِ nonce محاولتِنا — يُمرَّرُ للمكتبةِ لا يُخترَعُ هنا.
      expect(options.nonce).toBe(NONCE);
      expect(options.client_id).toBe(CLIENT_ID);
      callback({ id_token: ID_TOKEN });
    });
    expect(await beginTelegramWebLogin()).toBe(true);
    expect(recorded).toHaveLength(2);
    expect(recorded[0]).toMatchObject({
      url: `${CORE_URL}/v1/web-session/telegram/nonce`,
      method: "POST",
      credentials: "include",
    });
    expect(recorded[1]).toMatchObject({
      url: `${CORE_URL}/v1/web-session/telegram`,
      method: "POST",
      credentials: "include",
    });
    expect(JSON.parse(recorded[1]!.body!)).toEqual({ id_token: ID_TOKEN });
  });

  it("رفضُ النواةِ لفتحِ المحاولةِ → لا دخولَ ولا رمزَ في الذاكرةِ", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));
    expect(await beginTelegramWebLogin()).toBe(false);
    expect(currentWebCredential()).toBeNull();
  });

  it("رفضُ النواةِ لإتمامِ الدخولِ (الرمزُ أو الكوكيُّ مرفوضٌ) → لا رمزَ يُختزَنُ", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/nonce")) return nonceResponse();
      return new Response("{}", { status: 401 });
    });
    loginAuthMock.mockImplementation((_options, callback) => {
      callback({ id_token: ID_TOKEN });
    });
    expect(await beginTelegramWebLogin()).toBe(false);
    expect(currentWebCredential()).toBeNull();
  });

  it("إلغاءُ المستخدمِ أو خطأُ المكتبةِ (بلا id_token) → `false` ولا جلسةَ نواةٍ", async () => {
    stubCoreFlow();
    loginAuthMock.mockImplementation((_options, callback) => {
      callback({ error: "user_cancelled" });
    });
    expect(await beginTelegramWebLogin()).toBe(false);
    // الطلبُ الثاني (إتمامُ الدخولِ) لم يُرسَلْ أصلًا — لا رمزَ فلا جلسةَ.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(currentWebCredential()).toBeNull();
  });

  it("فشلُ الشبكةِ في أيِّ خطوةٍ → `false` لا رفعٍ يُسقِطُ التطبيقَ", async () => {
    fetchMock.mockRejectedValue(new TypeError("network down"));
    expect(await beginTelegramWebLogin()).toBe(false);
    expect(currentWebCredential()).toBeNull();
  });

  it("غيابُ مكتبةِ تيليجرامِ (فشلُ تحميلِ السكربتِ) → `false`", async () => {
    delete (window as unknown as { Telegram?: unknown }).Telegram;
    // لا سكربتَ يُحمَّلُ في الاختبارِ — `loadTelegramLoginLibrary` يرفعُ
    // فتُلتقَطُ في الداخلِ وتعودُ `false` (الرفعُ لا يُبرَّنُ هنا بل عدمُ الوصولِ).
    expect(await beginTelegramWebLogin()).toBe(false);
  });
});

// ── جسرُ المصغّرِ (CLM-0703): تبادلُ دليلِ المصغّرِ عندَ النواةِ ──────────────────
describe("جسرُ المصغّرِ — exchangeMiniAppInitDataAtCore (CLM-0703)", () => {
  const INIT_DATA = "query_id=1&user=%7B%7D&signature=abc";

  /** ردُّ النواةِ على التبادلِ الناجحِ — جلسةُ شخصٍ على قناةِ تيليجرامَ. */
  const coreSessionResponse = () =>
    new Response(
      JSON.stringify({
        session_id: "core-s-1",
        access_token: CORE_TOKEN,
        token_type: "Bearer",
        expires_at: "2026-10-23T13:00:00Z",
        identity_id: "i-1",
        identity_created: true,
      }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    );

  it("مُهيّأٌ بعنوانِ نواةٍ وحدَهُ — لا مُعرّفَ بوتِ هنا (الدليلُ يوقّعُهُ تيليجرامُ)", () => {
    expect(miniAppBridgeConfigured()).toBe(true);
    vi.stubEnv("VITE_CORE_URL", "");
    expect(miniAppBridgeConfigured()).toBe(false);
  });

  it("نجاحُ التبادلِ: نداءٌ حرفيٌّ بجسمِ الدليلِ، والرمزُ في خانةِ إثباتِ النواةِ", async () => {
    fetchMock.mockResolvedValueOnce(coreSessionResponse());
    expect(await exchangeMiniAppInitDataAtCore(INIT_DATA)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(`${CORE_URL}/v1/web-session/telegram/init-data`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ init_data: INIT_DATA });
    // الرمزُ في الذاكرةِ — نفسُ خانةِ الويبِ، فيصيرُ المصغّرُ والويبُ وجهينِ
    // لشخصٍ واحدٍ عندَ النواةِ.
    expect(currentWebCredential()).toEqual({ kind: "web_core_session", value: CORE_TOKEN });
  });

  it("رفضُ النواةِ (401 إعادةُ دليلٍ مستهلَكٍ) → `false` ولا رمزَ في الذاكرةِ", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "proof_already_used" }), { status: 401 }),
    );
    expect(await exchangeMiniAppInitDataAtCore(INIT_DATA)).toBe(false);
    expect(currentWebCredential()).toBeNull();
  });

  it("جسمٌ بلا access_token (تشوهٌ) → `false` ولا رمزَ يُختزَنُ", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ session_id: "s" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(await exchangeMiniAppInitDataAtCore(INIT_DATA)).toBe(false);
    expect(currentWebCredential()).toBeNull();
  });

  it("سقوطُ الشبكةِ → `false` ظاهرٌ لا رفعٌ يُسقِطُ التهيئةَ", async () => {
    fetchMock.mockRejectedValue(new TypeError("network down"));
    expect(await exchangeMiniAppInitDataAtCore(INIT_DATA)).toBe(false);
    expect(currentWebCredential()).toBeNull();
  });

  it("بلا نواةٍ موصولةٍ: لا نداءَ أصلًا — المسارُ القديمُ قرارُ البيئةِ لا الاحتياطَ", async () => {
    vi.stubEnv("VITE_CORE_URL", "");
    expect(await exchangeMiniAppInitDataAtCore(INIT_DATA)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
