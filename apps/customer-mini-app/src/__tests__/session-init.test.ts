/**
 * G-S8 (CLM-0610): direct tests for `session-init.ts` — init outcomes, expiry
 * and 401 re-init, the loop budget, single-flight, manual retry, and logout.
 * `fetch` and the Telegram host object are stubbed; time is faked (no real waiting).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useSessionStore } from "../store/session";
import {
  initSession,
  retrySession,
  startSessionLifecycle,
  logoutSession,
} from "../session/session-init";
import { detectHost, sessionRequest } from "../host";

const T0 = new Date("2026-10-18T06:00:00.000Z").getTime();

function sessionResponse(token: string, expiresInMs: number): Response {
  return new Response(
    JSON.stringify({
      token,
      wasla_public_id: "WS-1234567890",
      expires_at: new Date(Date.now() + expiresInMs).toISOString(),
      session_id: `s-${token}`,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function setTelegram(initData: string | null) {
  const w = window as unknown as { Telegram?: unknown };
  if (initData === null) delete w.Telegram;
  else w.Telegram = { WebApp: { initData, ready: vi.fn() } };
}

let fetchMock: ReturnType<typeof vi.fn>;
let stop: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  useSessionStore.setState({
    token: null, customerId: null, expiresAt: null, initStatus: "idle", initError: null,
  } as never);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  setTelegram("query_id=1&user=%7B%7D&hash=abc");
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  setTelegram(null);
});

describe("initSession", () => {
  it("outside Telegram fails as not_in_telegram without any network call", async () => {
    setTelegram(null);
    await expect(initSession()).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useSessionStore.getState().initStatus).toBe("failed");
    expect(useSessionStore.getState().initError).toBe("not_in_telegram");
  });

  it("posts init_data to /edge/session and stores the session in memory as ready", async () => {
    fetchMock.mockResolvedValueOnce(sessionResponse("tok-1", 3_600_000));
    await expect(initSession()).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/edge\/session$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ init_data: "query_id=1&user=%7B%7D&hash=abc" });
    const s = useSessionStore.getState();
    expect(s.token).toBe("tok-1");
    expect(s.customerId).toBe("WS-1234567890");
    expect(s.expiresAt).toBe(T0 + 3_600_000);
    expect(s.initStatus).toBe("ready");
    expect(s.isAuthenticated()).toBe(true);
  });

  it("an edge rejection fails as edge_rejected and stores no session", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "INIT_DATA_INVALID", message: "x" }), { status: 401 }),
    );
    await expect(initSession()).resolves.toBe(false);
    expect(useSessionStore.getState().token).toBeNull();
    expect(useSessionStore.getState().initError).toBe("edge_rejected");
  });

  it("a network error fails as network instead of rejecting", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(initSession()).resolves.toBe(false);
    expect(useSessionStore.getState().initStatus).toBe("failed");
    expect(useSessionStore.getState().initError).toBe("network");
  });

  it("an unparseable expires_at fails as invalid_response", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ token: "t", wasla_public_id: "WS-1", expires_at: "nope", session_id: "s" }), { status: 200 }),
    );
    await expect(initSession()).resolves.toBe(false);
    expect(useSessionStore.getState().token).toBeNull();
    expect(useSessionStore.getState().initError).toBe("invalid_response");
  });

  it("concurrent calls share a single request", async () => {
    fetchMock.mockResolvedValueOnce(sessionResponse("tok-1", 3_600_000));
    const [a, b] = await Promise.all([initSession(), initSession()]);
    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("startSessionLifecycle", () => {
  it("re-initializes automatically when the session expires", async () => {
    fetchMock
      .mockResolvedValueOnce(sessionResponse("tok-1", 60_000))
      .mockResolvedValueOnce(sessionResponse("tok-2", 3_600_000));
    stop = startSessionLifecycle();
    await vi.waitFor(() => expect(useSessionStore.getState().token).toBe("tok-1"));
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() => expect(useSessionStore.getState().token).toBe("tok-2"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useSessionStore.getState().initStatus).toBe("ready");
  });

  it("re-initializes once when a 401 clears the session", async () => {
    fetchMock
      .mockResolvedValueOnce(sessionResponse("tok-1", 3_600_000))
      .mockResolvedValueOnce(sessionResponse("tok-2", 3_600_000));
    stop = startSessionLifecycle();
    await vi.waitFor(() => expect(useSessionStore.getState().token).toBe("tok-1"));
    useSessionStore.getState().clearSession(); // what api/client does on 401
    await vi.waitFor(() => expect(useSessionStore.getState().token).toBe("tok-2"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops re-initializing after the budget and fails as retry_limit (no loop)", async () => {
    fetchMock.mockImplementation(async () => sessionResponse(`tok-${fetchMock.mock.calls.length}`, 3_600_000));
    stop = startSessionLifecycle({ maxAutoReinit: 3, windowMs: 300_000 });
    await vi.waitFor(() => expect(useSessionStore.getState().initStatus).toBe("ready"));
    for (let i = 0; i < 6; i++) {
      useSessionStore.getState().clearSession();
      await vi.advanceTimersByTimeAsync(10);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1 + 3);
    expect(useSessionStore.getState().initStatus).toBe("failed");
    expect(useSessionStore.getState().initError).toBe("retry_limit");
    expect(useSessionStore.getState().token).toBeNull();
  });

  it("does not retry on its own after a failed init", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 503 }));
    stop = startSessionLifecycle();
    await vi.waitFor(() => expect(useSessionStore.getState().initStatus).toBe("failed"));
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a manual retry after failure starts a new session", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(sessionResponse("tok-ok", 3_600_000));
    stop = startSessionLifecycle();
    await vi.waitFor(() => expect(useSessionStore.getState().initStatus).toBe("failed"));
    await expect(retrySession()).resolves.toBe(true);
    expect(useSessionStore.getState().token).toBe("tok-ok");
    expect(useSessionStore.getState().initStatus).toBe("ready");
  });

  it("logout clears the session without re-initializing", async () => {
    fetchMock
      .mockResolvedValueOnce(sessionResponse("tok-1", 3_600_000))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    stop = startSessionLifecycle();
    await vi.waitFor(() => expect(useSessionStore.getState().token).toBe("tok-1"));
    await logoutSession();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(useSessionStore.getState().token).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]![0])).toMatch(/\/edge\/session\/logout$/);
  });
});

// ── XR-8.2 (CLM-0657): طبقةُ المضيف ─────────────────────────────────────────

describe("host detection (src/host/)", () => {
  it("Telegram with initData is the telegram host and yields its credential", () => {
    const host = detectHost();
    expect(host.kind).toBe("telegram");
    expect(host.sessionCredential()).toEqual({
      kind: "telegram_init_data",
      value: "query_id=1&user=%7B%7D&hash=abc",
    });
  });

  it("the official SDK outside Telegram (empty initData) is a browser, not Telegram", () => {
    setTelegram("");
    const host = detectHost();
    expect(host.kind).toBe("browser");
    expect(host.sessionCredential()).toBeNull();
  });

  it("no SDK at all is a browser with no credential", () => {
    setTelegram(null);
    expect(detectHost().kind).toBe("browser");
    expect(detectHost().sessionCredential()).toBeNull();
  });

  it("ready() reaches Telegram only through the telegram host", async () => {
    const ready = vi.fn();
    (window as unknown as { Telegram: unknown }).Telegram = { WebApp: { initData: "a=1", ready } };
    fetchMock.mockResolvedValueOnce(sessionResponse("tok-1", 3_600_000));
    await expect(initSession()).resolves.toBe(true);
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it("a browser never calls the edge and never calls ready()", async () => {
    setTelegram(null);
    await expect(initSession()).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps the Telegram credential to the edge contract unchanged", () => {
    expect(sessionRequest({ kind: "telegram_init_data", value: "x=1" })).toEqual({
      path: "/edge/session",
      body: { init_data: "x=1" },
    });
  });
});

// يقرأُ كلَّ ملفّاتِ الإنتاجِ في src/ (بلا الاختباراتِ وبلا src/host/) بعدَ إزالةِ
// التعليقاتِ والنصوصِ الحرفيّة — النثرُ والترجماتُ تذكرُ تيليجرام شرحًا لا استدعاءً —
// ويفشلُ إن ظهر معرّفٌ خاصٌّ بمنصّة. الحدُّ المُعلَن: الوصولُ عبرَ نصٍّ محسوبٍ
// (window["Tele" + "gram"]) لا يُرى؛ هذا حارسٌ للخطأ الشائعِ لا لقصدِ التحايل.
const PLATFORM_IDENTIFIERS = /\b(Telegram|WebApp|initData|init_data|DiscordSDK|Capacitor)\b/;

function stripCommentsAndStrings(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && n === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
    } else if (c === '"' || c === "'" || c === "`") {
      i++;
      while (i < src.length && src[i] !== c) i += src[i] === "\\" ? 2 : 1;
      i++;
      out += '""';
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function hostBoundaryViolations(files: Record<string, string>): string[] {
  return Object.entries(files)
    .filter(([path]) => !path.includes("/__tests__/") && !path.includes("/host/"))
    .filter(([, src]) => PLATFORM_IDENTIFIERS.test(stripCommentsAndStrings(src)))
    .map(([path]) => path);
}

describe("host boundary guard", () => {
  const sources = import.meta.glob<string>("../**/*.{ts,tsx}", {
    query: "?raw",
    import: "default",
    eager: true,
  });

  it("scans the real tree (the session module and src/host/ are present)", () => {
    const paths = Object.keys(sources);
    expect(paths.some((p) => p.endsWith("/session/session-init.ts"))).toBe(true);
    expect(paths.some((p) => p.endsWith("/host/telegram.ts"))).toBe(true);
  });

  it("no production file outside src/host/ names a platform SDK", () => {
    expect(hostBoundaryViolations(sources)).toEqual([]);
  });

  it("a planted direct Telegram call outside src/host/ is caught", () => {
    const planted = {
      "../screens/Planted.tsx": "const d = (window as any).Telegram.WebApp.initData; // planted",
    };
    expect(hostBoundaryViolations(planted)).toEqual(["../screens/Planted.tsx"]);
  });

  it("the same call inside src/host/, or only in prose and strings, passes", () => {
    expect(
      hostBoundaryViolations({
        "../host/x.ts": "window.Telegram.WebApp.ready();",
        "../i18n/x.ts": 'const m = "Open the app from Telegram"; /* Telegram.WebApp */',
      }),
    ).toEqual([]);
  });
});

