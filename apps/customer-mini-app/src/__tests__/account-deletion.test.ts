/**
 * وحدةُ نقلِ حذفِ الحسابِ (D-XR-13 · CLM-0699) — عقدُ النداءِ إلى النواةِ.
 *
 * العقدُ المرجعيُّ: `POST /v1/me/deletion` في wasla-core PR #23 — 204 بلا
 * جسمٍ عندَ النجاحِ، و409 `DeletionConflict` يحملُ `details.organization_ids`،
 * و401/403 كما هما. كلُّ حالةٍ هنا تُثبِتُ شكلَ الطلبِ المُرسَلِ فعلًا (العنوانَ
 * والطريقةَ والترويسةَ) لا النتيجةَ وحدَها — نمطُ `web-login.test.ts`.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  accountDeletionAvailable,
  requestAccountDeletion,
} from "../host/account-deletion";
import {
  clearWebCredential,
  currentWebCredential,
  setWebCredentialForE2E,
} from "../host/web-login";

const CORE_URL = "https://core.example";

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
}

let fetchMock: ReturnType<typeof vi.fn>;
let recorded: RecordedRequest[];

beforeEach(() => {
  vi.stubEnv("VITE_CORE_URL", CORE_URL);
  // علّامةُ E2E — لا بذرَ بلاها (الواقيةُ نفسُها التي في main.tsx).
  vi.stubEnv("VITE_E2E", "true");
  clearWebCredential();
  recorded = [];
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    recorded.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("accountDeletionAvailable", () => {
  it("متاحٌ بإثباتِ ويبٍ وعنوانِ نواةٍ", () => {
    setWebCredentialForE2E("core-token");
    expect(accountDeletionAvailable()).toBe(true);
  });

  it("غيرُ متاحٍ بلا إثباتٍ (المصغّرُ داخلَ تيليجرامَ — الحدُّ المعلَنُ)", () => {
    expect(accountDeletionAvailable()).toBe(false);
  });

  it("غيرُ متاحٍ بلا عنوانِ نواةٍ مهما كانَ الإثباتُ", () => {
    setWebCredentialForE2E("core-token");
    vi.stubEnv("VITE_CORE_URL", "");
    expect(accountDeletionAvailable()).toBe(false);
  });
});

describe("requestAccountDeletion — العقدُ معَ النواةِ", () => {
  it("204: نجاحٌ — النداءُ على العنوانِ الحرفيِّ بترويسةِ الحاملِ، والإثباتُ يُمسَحُ", async () => {
    setWebCredentialForE2E("core-token");

    const outcome = await requestAccountDeletion();

    expect(outcome).toEqual({ status: "deleted" });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.url).toBe(`${CORE_URL}/v1/me/deletion`);
    expect(recorded[0]!.method).toBe("POST");
    expect((recorded[0]!.headers as { Authorization?: string }).Authorization).toBe(
      "Bearer core-token",
    );
    // الجلسةُ ماتت عندَ النواةِ — لا يبقى رمزٌ صالحٌ في الذاكرةِ.
    expect(currentWebCredential()).toBeNull();
  });

  it("409: مديرٌ — تُستخرَجُ المنظماتُ المسمّاةُ من `details.organization_ids`", async () => {
    setWebCredentialForE2E("core-token");
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: "conflict",
          message: "transfer or close the organizations you administer first",
          retryable: false,
          correlation_id: "c-1",
          details: { organization_ids: ["org-a", "org-b"] },
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    );

    const outcome = await requestAccountDeletion();

    expect(outcome).toEqual({
      status: "refused_admin",
      organizationIds: ["org-a", "org-b"],
    });
    // الرفضُ لا يقتلُ الإثباتَ — الحسابُ باقٍ والجلسةُ صالحةٌ.
    expect(currentWebCredential()?.value).toBe("core-token");
  });

  it("409 بأعضاءَ مشوهةٍ: لا جسمَ يُسقِطُ الرفضَ — قائمةٌ فارغةٌ لا رميٌ", async () => {
    setWebCredentialForE2E("core-token");
    fetchMock.mockResolvedValueOnce(
      new Response("<html>", { status: 409 }),
    );

    const outcome = await requestAccountDeletion();

    expect(outcome).toEqual({ status: "refused_admin", organizationIds: [] });
  });

  it("401: الإثباتُ ماتَ — يُمسَحُ ولا يبقى وهمًا صالحًا", async () => {
    setWebCredentialForE2E("core-token");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "unauthenticated" }), { status: 401 }),
    );

    const outcome = await requestAccountDeletion();

    expect(outcome).toEqual({ status: "unauthenticated" });
    expect(currentWebCredential()).toBeNull();
  });

  it("403: جسالةُ خدمةٍ — تُعلَنُ لا تُبتلَعُ (لا تحدثُ من هذا التطبيقِ)", async () => {
    setWebCredentialForE2E("core-token");
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "forbidden" }), { status: 403 }),
    );

    const outcome = await requestAccountDeletion();

    expect(outcome).toEqual({ status: "forbidden" });
  });

  it("بلا إثباتِ ويبٍ: لا نداءَ أصلًا — الحدُّ المعلَنُ للمصغّرِ", async () => {
    const outcome = await requestAccountDeletion();

    expect(outcome).toEqual({ status: "no_web_credential" });
    expect(recorded).toHaveLength(0);
  });

  it("سقوطُ الشبكةِ: فشلٌ صريحٌ والإثباتُ باقٍ — إعادةُ المحاولةِ آمنةٌ", async () => {
    setWebCredentialForE2E("core-token");
    fetchMock.mockRejectedValueOnce(new TypeError("network down"));

    const outcome = await requestAccountDeletion();

    expect(outcome).toEqual({ status: "network" });
    expect(currentWebCredential()?.value).toBe("core-token");
  });

  it("جوابٌ غيرُ متوقَّعٍ: يُعلَنُ رقمُهُ لا يُصمَّتُ", async () => {
    setWebCredentialForE2E("core-token");
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));

    const outcome = await requestAccountDeletion();

    expect(outcome).toEqual({ status: "unknown", statusCode: 503 });
  });
});
