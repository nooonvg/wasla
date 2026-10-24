/**
 * `partner-contract-experiment.test.ts` — **تجربةُ العقدِ الحاسمةِ لشريحةِ ب.2**
 * (مذكرةُ التصميمِ: docs/11-partners/B2_PARTNER_MINI_APP_SLICE.md §4).
 *
 * **ما تُثبتهُ هذهِ التجربةُ (جانبُ الهويةِ):**
 * 1. إصدارُ جلسةٍ حقيقيةٍ لشخصٍ عبرَ تطبيقِ الهويةِ **الحقيقيِّ** (مستودعاتُ ذاكرةٍ)
 *    على منفذٍ حقيقيٍّ — بمنافذِ الإنتاجِ نفسِها (`buildCustomerBotSessionPorts`).
 * 2. استبدالُ الجلسةِ بجمهورِ `marketplace` — مسموحٌ لفاعلِ `customer`
 *    (`ASSERTION_AUDIENCES_BY_ACTOR`) — والتأكيدُ **موقَّعٌ فعلاً** بتحققٍ حقيقيٍّ.
 * 3. التأكيدُ يحملُ: الشخصَ (`sub` = المعرّفُ العامُّ) · الفاعلَ (`act` = customer) ·
 *    الجمهورَ (`aud` ∋ marketplace) · المُمرِّرَ (`via` = customer-bot).
 * 4. الرفضُ: جلسةٌ مجهولةٌ · جلسةٌ مسحوبةٌ (إعادةُ الاستخدامِ بعدَ الخروجِ تفشل).
 *
 * **وما لا تدّعيهُ:** هذهِ التجربةُ تُثبتُ عقدَ الهويةِ والاستبدالِ — إنفاذُ العضويةِ عندَ
 * `marketplace` يُثبَتُ في اختبارِ الطاقمِ هناك (جانبُ السوقِ)؛ والرابطُ بينَهما
 * هو المعرّفُ العامُّ نفسُهُ (`wasla_public_id`): مِنَ الجلسةِ إلى `obo` النداءِ إلى
 * عضويةِ المتجرِ.
 *
 * **حدٌّ تعاقديٌّ مسجَّلٌ (M1-05):** `customer-bot` لا يملكُ جمهورَ `marketplace` —
 * نجاحُ هذهِ التجربةِ بمنافذِ الإنتاجِ (التوقيعُ للهويةِ) لا يعني ملكَهُ نداءَ
 * `marketplace`؛ ذاكَ منحةُ إنتاجٍ تُتَّخذُ بقرارٍ تقنيٍّ عبرَ مسارِ الحوكمةِ.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";

import {
  CryptoIdGenerator,
  InMemoryIdentityRepository,
  InMemoryOutbox,
  InMemoryPublicIdSequence,
  InMemorySessionRepository,
  SystemClock,
  createIdentityApp,
} from "@wasla/identity-service";
import {
  InMemoryServiceTokenReplayGuard,
  ServiceAuthKeyRegistry,
  createServiceRequestSigner,
} from "@wasla/service-auth";
import { verifyUserAssertion } from "@wasla/service-auth/user-assertion";
import { buildCustomerBotSessionPorts } from "@wasla/customer-bot";

/** زوجُ مفاتيحِ Ed25519 — توقيعُ تأكيدِ المستخدمِ وتحققُهُ (لا سرٍّ تشغيليٍّ). */
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const USER_ASSERTION_KID = "ua-experiment";
const signingKey = { kid: USER_ASSERTION_KID, privateKey };
const publicKeys = new Map([[USER_ASSERTION_KID, publicKey]]);

/** سجلُّ مفاتيحِ الخدمةِ — نفسُهُ لموقِّعِ `customer-bot` ولمتحقِّقِ الهويةِ. */
const TEST_ACTIVE_KID = "test-active";
const TEST_SERVICE_SECRET = "identity-test-secret-0123456789ab";
const keys = new ServiceAuthKeyRegistry({
  keys: [{ kid: TEST_ACTIVE_KID, secret: TEST_SERVICE_SECRET, status: "active" }],
  activeKid: TEST_ACTIVE_KID,
});

const ENV: Record<string, string> = {
  CUSTOMER_BOT_TOKEN: "111222333:AAHexperiment-test-token-0123456789",
  WASLA_SERVICE_AUTH_KEYS: `${TEST_ACTIVE_KID}:active:${TEST_SERVICE_SECRET}`,
  WASLA_SERVICE_AUTH_ACTIVE_KID: TEST_ACTIVE_KID,
};

const TELEGRAM_USER_ID = 777001;

/**
 * حلُّ الهويةِ عندَ أوّلِ لقاءٍ — نفسُ فعلِ البوتِ عندَ `/start` (إيجادٌ أو إنشاءٌ):
 * جلسةُ القناةِ لا تُصدَرُ لغيرِ هويةٍ مرتبطةٍ، فالحلُّ خطوةُ الإعدادِ الأولى.
 */
async function resolveIdentityFor(telegramUserId: number): Promise<string> {
  const signer = createServiceRequestSigner({
    serviceName: "customer-bot",
    audience: "identity",
    keys,
    scopes: ["identity:resolve:write"],
  });
  const response = await fetch(`${identityUrl}/identity/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json", ...signer("POST", "/identity/resolve") },
    body: JSON.stringify({ telegram_user_id: telegramUserId }),
  });
  const payload = (await response.json()) as { wasla_public_id?: string };
  if (response.status !== 200 && response.status !== 201) {
    throw new Error(`identity resolve returned ${response.status}`);
  }
  return String(payload.wasla_public_id ?? "");
}

let app: ReturnType<typeof createIdentityApp>;
let identityUrl = "";
let ports: ReturnType<typeof buildCustomerBotSessionPorts>;

beforeAll(async () => {
  const repo = new InMemoryIdentityRepository();
  const clock = new SystemClock();
  const idGen = new CryptoIdGenerator();
  app = createIdentityApp({
    deps: {
      repo,
      outbox: new InMemoryOutbox(),
      publicIdSeq: new InMemoryPublicIdSequence(),
      clock,
      idGen,
    },
    logger: false,
    serviceIdentity: { keys, replayGuard: new InMemoryServiceTokenReplayGuard() },
    session: {
      sessions: new InMemorySessionRepository(),
      repo,
      clock,
      idGen,
    },
    userAssertion: { signingKey },
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address();
  identityUrl =
    typeof address === "object" && address !== null
      ? `http://127.0.0.1:${address.port}`
      : "";
  ports = buildCustomerBotSessionPorts({ identityUrl, env: ENV });
});

afterAll(async () => {
  await app.close();
});

describe("تجربةُ العقدِ — ب.2: جلسةُ العميلِ ← استبدالٌ بجمهورِ marketplace", () => {
  it("إصدارُ جلسةٍ حقيقيةٍ لشخصٍ (customer) ثمَّ استبدالُها بجمهورِ marketplace: التأكيدُ موقَّعٌ فعلاً ويحملُ الشخصَ والفاعلَ والجمهورَ والمُمرِّرَ", async () => {
    // (0) حلُّ الهويةِ عندَ أوّلِ لقاءٍ — الجلسةُ لا تُصدَرُ لغيرِ هويةٍ مرتبطةٍ.
    const resolvedPublicId = await resolveIdentityFor(TELEGRAM_USER_ID);
    expect(resolvedPublicId).toMatch(/^WS-/);

    // (1) الإصدارُ — منفذُ الإنتاجِ الحقيقيُّ ← تطبيقُ الهويةِ الحقيقيُّ.
    const issued = await ports.issueSession({
      telegram_user_id: TELEGRAM_USER_ID,
      init_data_fingerprint: "b2a1".padEnd(64, "0"),
      telegram_username: "store_owner_experiment",
      telegram_first_name: "Owner",
    });
    expect(issued.actor_type).toBe("customer");
    expect(issued.wasla_public_id).toMatch(/^WS-/);
    expect(issued.token).not.toBe("");
    expect(issued.expires_at).not.toBe("");

    // (2) الاستبدالُ بجمهورِ marketplace — مسموحٌ لفاعلِ العميلِ.
    const exchanged = await ports.exchangeSession({
      session_token: issued.token,
      audience: ["marketplace"],
    });
    expect(exchanged.actor_type).toBe("customer");
    expect(exchanged.wasla_public_id).toBe(issued.wasla_public_id);
    expect(exchanged.audience).toContain("marketplace");

    // (3) التأكيدُ موقَّعٌ فعلاً — تحققٌ حقيقيٌّ لا مجرَّدَ حضورٍ.
    //     الجمهورُ marketplace · obo الشخصُ · المُمرِّرُ customer-bot.
    const verdict = verifyUserAssertion(exchanged.assertion, {
      publicKeys,
      audience: "marketplace",
      onBehalfOfPublicId: issued.wasla_public_id,
      callerService: "customer-bot",
      now: new Date(),
    });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      // الشخصُ (sub) والفاعلُ (act) والجمهورُ (aud) — عقدُ الشريحةِ.
      expect(verdict.payload.sub).toBe(issued.wasla_public_id);
      expect(verdict.payload.act).toBe("customer");
      expect(verdict.payload.aud).toContain("marketplace");
      expect(verdict.payload.via).toBe("customer-bot");
    }
  });

  it("جلسةٌ مجهولةٌ: الاستبدالُ يُرفضُ بـ`EdgeSessionRejectedError` — لا تأكيدَ لغيرِ جلسةٍ قائمةٍ", async () => {
    await expect(
      ports.exchangeSession({
        session_token: "no-such-session-token-anywhere",
        audience: ["marketplace"],
      }),
    ).rejects.toMatchObject({ name: "EdgeSessionRejectedError" });
  });

  it("بعدَ السحبِ: الاستبدالُ يُرفضُ — إعادةُ الاستخدامِ بعدَ الخروجِ تفشلُ", async () => {
    await resolveIdentityFor(TELEGRAM_USER_ID + 1);
    const issued = await ports.issueSession({
      telegram_user_id: TELEGRAM_USER_ID + 1,
      init_data_fingerprint: "b2b2".padEnd(64, "0"),
    });
    // السحبُ — منفذُ الإنتاجِ الحقيقيُّ.
    const revoked = await ports.revokeSession({ session_token: issued.token });
    expect(revoked.revoked).toBe(true);
    // إعادةُ الاستخدامِ تفشلُ: الاستبدالُ بعدَ السحبِ مرفوضٌ.
    await expect(
      ports.exchangeSession({
        session_token: issued.token,
        audience: ["marketplace"],
      }),
    ).rejects.toMatchObject({ name: "EdgeSessionRejectedError" });
  });
});
