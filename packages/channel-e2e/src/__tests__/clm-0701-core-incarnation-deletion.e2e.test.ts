/**
 * اختبارُ القبولِ لرحلةِ حذفِ حسابِ CORE عبرَ أجيالِه (CLM-0701 · استثناءُ
 * ADR-076 المؤرّخُ 2026-10-25 · المُصرَّحُ بهِ منَ المالكِ).
 *
 * الرحلةُ التي يُثبِتُها هذا الاختبارُ لا تُثبِتُها وحدةٌ أصغرُ — لأنّ
 * الحذفَ ليسَ فعلاً في خدمةٍ واحدةٍ بل حقيقةٌ عبرَ ثلاثتِها:
 *
 *   1. A يعبرُ الجسرَ بجيلِ حسابِهِ (genA) على قناةِ تيليجرامَ T، فيأخذُ
 *      هويّةَ MARKET (WS-A)، ويملؤُ بياناتِهِ (اسمُ عرضٍ + مكانٌ محفوظٌ)،
 *      ويُصدَرُ لهُ جلسةٌ.
 *   2. B يُعيدُ التسجيلَ على القناةِ نفسِها (T) بجيلٍّ جديدٍ (genB) — فيأخذُ
 *      هويّةً جديدةً فارغةً (WS-B) لا إرثَ لبياناتِ A، ويُنقَلُ الرابطُ
 *      إليها (القيدُ الفريدُ على القناةِ لا يُكسرُ).
 *   3. حدثُ حذفِ حسابِ A **المؤجَّلُ** يصلُ إلى مستهلِكِ خدمةِ الزبائنِ —
 *      فيُنقّى ما يُغطّيه الحدثُ من بياناتِ A (اسمُ العرضِ والأماكنُ)، ثمّ
 *      يُطبَّقُ الحذفُ على هويّةِ A (تسطيحٌ + سحبُ الجلساتِ).
 *   4. والقرارُ: بياناتُ A المُغطّاةُ زالت، وبياناتُ B ووصولُهُ بقيا،
 *      وجلسةُ A القديمةُ مرفوضةٌ، وجيلُ A لا يُحلُّ أبداً.
 *
 * **والقياسُ هو الحدودُ المنشورةُ نفسُها:** الحلُّ والربطُ والتطبيقُ عبرَ
 * مساراتِ HTTP الحقيقيّةِ للتطبيقِ (`createIdentityApp`)، والمستهلكُ هو
 * `consumeCoreAccountDeletionEvent` نفسُهُ بلا نسخةٍ، والتنقيةُ عبرَ مستودعِ
 * الزبائنِ القائمِ. النقلُ (الناقلُ الحقيقيُّ للحدثِ) مؤجّلٌ إلى XR-4.3 —
 * وهذا الاختبارُ هو البوّابةُ التي سيتعلَّقُ بها السلكُ.
 *
 * Postgres حقيقيٌّ عبرَ `DATABASE_URL` (نفسَ قاعدةَ الجولاتِ الأخرى): الحذفَ
 * والربطَ والقيدَ الفريدَ لا يُثبِتُها محوِّلٌ في الذاكرةِ.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  CryptoIdGenerator,
  PostgresCoreIdentityBindingStore,
  PostgresIdentityRepository,
  PostgresOutbox,
  PostgresPublicIdSequence,
  PostgresSessionRepository,
  createDb,
  ensurePublicIdSequence,
  createIdentityApp,
  verifySessionToken,
  type Db,
} from "@wasla/identity-service";
import {
  InMemoryCoreAccountDeletionInbox,
  InMemoryCustomerRepository,
  consumeCoreAccountDeletionEvent,
} from "@wasla/customers-service";
import {
  InMemoryServiceTokenReplayGuard,
  ServiceAuthKeyRegistry,
  serviceAuthHeaders,
} from "@wasla/service-auth";
import type { Pool as PgPool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const T0 = new Date("2026-10-25T00:00:00.000Z");
const TEST_SERVICE_SECRET = "clm-0701-test-service-secret-012345";
const TEST_ACTIVE_KID = "test-active-clm-0701";

/** ساعةٌ يقودها الاختبارُ — التقديرُ الزمنيُّ هنا مقصودٌ لا «تجاوزٌ». */
class TestClock {
  constructor(private readonly at: Date) {}
  now(): string {
    return this.at.toISOString();
  }
}

const ALL_IDENTITY_SCOPES: readonly string[] = [
  "identity:resolve:write",
  "identity:user:read",
  "identity:link:write",
  "identity:recovery:write",
  "identity:history:read",
  "identity:assertion:issue",
  "identity:session:issue",
  "identity:session:exchange",
  "identity:session:revoke",
  "identity:core-binding:read",
  "identity:core-deletion:write",
];

function createTestKeyRegistry(
  secret: string = TEST_SERVICE_SECRET,
): ServiceAuthKeyRegistry {
  return new ServiceAuthKeyRegistry({
    keys: [{ kid: TEST_ACTIVE_KID, secret, status: "active" }],
    activeKid: TEST_ACTIVE_KID,
  });
}

/** بصمةُ جلسةٍ اصطناعيّةٌ — 64 محرفًا hex كما يطلبُ عقدُ العمودِ. */
function fingerprint(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)(
  "رحلةُ القبولِ: أجيالُ حسابِ النواةِ وحذفُهُ (CLM-0701)",
  () => {
    let pool: PgPool;
    let db: Db;
    let app: ReturnType<typeof createIdentityApp>;
    let repo: PostgresIdentityRepository;
    let sessionsRepo: PostgresSessionRepository;
    let clock: TestClock;
    let idGen: CryptoIdGenerator;

    /** مستودعُ بياناتِ الزبائنِ (في الذاكرةِ) + صندوقُ الاستهلاكِ. */
    let customersRepo: InMemoryCustomerRepository;
    let inbox: InMemoryCoreAccountDeletionInbox;

    function signFor(method: string, url: string): Record<string, string> {
      const headers = serviceAuthHeaders({
        serviceName: "customer-bot",
        audience: "identity",
        method: method.toUpperCase(),
        path: url,
        keys: createTestKeyRegistry(),
        now: new Date(clock.now()),
        scopes: ALL_IDENTITY_SCOPES,
      });
      // جسمُ الطلبِ JSON: fastify يرفضُ حزمةً بلا `Content-Type` بـ415 —
      // والتوقيعُ يغطّي المسارَ لا الترويساتِ فلا يفسدُ إضافتُهُ شيئاً.
      if (method.toUpperCase() !== "GET") {
        headers["content-type"] = "application/json";
      }
      return headers;
    }

    /** منفذُ الهويّةِ كما ستبدو حقيقتُهُ في الإنتاجِ: نداءاتُ HTTP لا نداءاتٍ داخليةٍ. */
    function httpIdentityDeletionPort() {
      return {
        async findCoreBinding(coreIdentityId: string) {
          const path = `/identity/core-bindings/${encodeURIComponent(coreIdentityId)}`;
          const res = await app.inject({
            method: "GET",
            url: path,
            headers: signFor("GET", path),
          });
          if (res.statusCode === 404) return null;
          expect(res.statusCode).toBe(200);
          const body = res.json() as { wasla_public_id: string };
          return { waslaPublicId: body.wasla_public_id };
        },
        async applyCoreDeletion(input: {
          coreIdentityId: string;
          deletedAt?: string;
        }) {
          const res = await app.inject({
            method: "POST",
            url: "/identity/core-deletion",
            headers: signFor("POST", "/identity/core-deletion"),
            payload: JSON.stringify({
              core_identity_id: input.coreIdentityId,
              ...(input.deletedAt === undefined
                ? {}
                : { deleted_at: input.deletedAt }),
            }),
          });
          expect(res.statusCode).toBe(200);
          const body = res.json() as {
            applied: boolean;
            wasla_public_id: string;
            reason?: string;
          };
          return {
            applied: body.applied,
            waslaPublicId: body.wasla_public_id,
            ...(body.reason === undefined ? {} : { reason: body.reason }),
          };
        },
      };
    }

    async function resolveViaHttp(
      body: Record<string, unknown>,
    ): Promise<{ statusCode: number; json: () => Promise<unknown> }> {
      const res = await app.inject({
        method: "POST",
        url: "/identity/resolve",
        headers: signFor("POST", "/identity/resolve"),
        payload: JSON.stringify(body),
      });
      return { statusCode: res.statusCode, json: () => res.json() };
    }

    async function issueSessionViaHttp(
      telegramUserId: number,
      seed: string,
    ): Promise<{ statusCode: number; token: string; waslaPublicId: string }> {
      const res = await app.inject({
        method: "POST",
        url: "/identity/sessions",
        headers: signFor("POST", "/identity/sessions"),
        payload: JSON.stringify({
          telegram_user_id: telegramUserId,
          init_data_fingerprint: fingerprint(seed),
        }),
      });
      const body = res.json() as { token: string; wasla_public_id: string };
      return {
        statusCode: res.statusCode,
        token: body.token,
        waslaPublicId: body.wasla_public_id,
      };
    }

    beforeAll(async () => {
      const created = createDb({ connectionString: DATABASE_URL! });
      pool = created.pool;
      db = created.db;
      await pool.query(
        "DROP TABLE IF EXISTS core_identity_bindings, identity_sessions, identity_outbox, identity_recovery_requests, identity_history, identity_links, identity_users CASCADE",
      );
      const ddl = await readFile(
        resolve(process.cwd(), "../../services/identity/contracts/schema.sql"),
        "utf-8",
      );
      await pool.query(ddl);
      await ensurePublicIdSequence(db);

      repo = new PostgresIdentityRepository(db);
      sessionsRepo = new PostgresSessionRepository(db);
      clock = new TestClock(T0);
      idGen = new CryptoIdGenerator();

      app = createIdentityApp({
        deps: {
          repo,
          outbox: new PostgresOutbox(db),
          publicIdSeq: new PostgresPublicIdSequence(db),
          clock,
          idGen,
          coreBindings: new PostgresCoreIdentityBindingStore(db),
        },
        serviceIdentity: {
          keys: createTestKeyRegistry(),
          replayGuard: new InMemoryServiceTokenReplayGuard({
            now: () => new Date(clock.now()),
          }),
          // **ساعةُ فرضِ هويّةِ الخدمةِ يقودها الاختبارُ لا الجدارُ** (نمطُ
          // clm-0519): التوقيعُ على `now: clock.now()` المجمدِ والتحقّقُ على
          // `Date.now()` الحقيقيِّ في CI يُصدِرُ رمزاً «منتهياً» بفرقِ الساعاتِ
          // فيُرفَضَ بـ401 — فتُربَطُ ساعةُ التحقّقِ بالساعةِ نفسِها.
          now: () => new Date(clock.now()),
        },
        session: { sessions: sessionsRepo, repo, clock, idGen },
      });

      customersRepo = new InMemoryCustomerRepository();
      inbox = new InMemoryCoreAccountDeletionInbox();

      // تشخيصٌ لبيئةِ CI وحدَها (لا قاعدةَ محليّةً): التطبيقُ يُغلِّفُ الأخطاءَ
      // غيرَ المصنّفةِ بـ503 بلا سببٍ معادٍ (I-13) — وهذا الخطّافُ يُظهرُ الخطأَ
      // نفسَهُ في سجلِّ الاختبارِ ليُشخَّصَ لا ليُخمَّنَ.
      app.addHook("onError", async (request, _reply, error) => {
        console.log(
          `[clm-0701] swallowed error on ${request.method} ${request.url}:`,
          error instanceof Error ? error.stack : error,
        );
      });
    });

    afterAll(async () => {
      if (pool !== undefined) await pool.end();
    });

    it("A ← إعادةُ تسجيلِ B ← حدثُ الحذفِ المؤجَّلُ: الفصلُ الكاملُ بينَ الأجيالِ", async () => {
      // ─── 1. A يعبرُ الجسرَ بجيلِهِ ───
      const genA = "core-gen-alpha";
      const telegramT = 510_701;

      const a = await resolveViaHttp({
        telegram_user_id: telegramT,
        telegram_username: "alpha_user",
        core_identity_id: genA,
        source: "customer_bot",
      });
      expect(a.statusCode).toBe(201);
      const aBody = (await a.json()) as {
        wasla_public_id: string;
        created: boolean;
      };
      expect(aBody.created).toBe(true);
      const wsA = aBody.wasla_public_id;

      // A يملأ بياناتِهِ ويأخذُ جلسةً.
      const aSession = await issueSessionViaHttp(telegramT, "init-A");
      expect(aSession.statusCode).toBe(201);
      expect(aSession.waslaPublicId).toBe(wsA);
      await customersRepo.saveProfile({
        waslaPublicId: wsA,
        displayName: "عبدالله",
        preferredLocale: "ar",
        defaultZoneId: null,
        status: "active",
        suspensionReasonCode: null,
        createdAt: clock.now(),
        updatedAt: clock.now(),
      });
      await customersRepo.insertPlace({
        id: "place-A-1",
        waslaPublicId: wsA,
        label: "البيت",
        zoneId: "z-01",
        addressText: "حيّ السلام",
        coordinates: { latitude: 21.4, longitude: 39.8 },
        idempotencyKey: "place-A-1-key",
        createdAt: clock.now(),
      });

      // ─── 2. B يُعيدُ التسجيلَ على القناةِ نفسِها بجيلٍّ جديدٍ ───
      const genB = "core-gen-beta";
      const b = await resolveViaHttp({
        telegram_user_id: telegramT,
        telegram_username: "alpha_user",
        core_identity_id: genB,
        source: "customer_bot",
      });
      expect(b.statusCode).toBe(201);
      const bBody = (await b.json()) as {
        wasla_public_id: string;
        created: boolean;
      };
      expect(bBody.created).toBe(true);
      const wsB = bBody.wasla_public_id;
      // هوّيّةٌ جديدةٌ لا إرثَ: مفتاحُ A لا يُشارَكُ.
      expect(wsB).not.toBe(wsA);

      // بياناتُ B منفصلةٌ فارغةٌ (لا ملفَّ، لا مكاناً).
      expect(await customersRepo.findProfile(wsB)).toBeNull();
      expect(await customersRepo.listPlaces(wsB)).toEqual([]);

      // رابطُ القناةِ انتقلَ إلى B — القناةُ الواحدةُ مالكٌ واحدٌ في كلِّ لحظةٍ.
      const linkOwner = await repo.findUserByTelegramId(String(telegramT));
      expect(linkOwner?.waslaPublicId).toBe(wsB);

      // ─── 3. حدثُ حذفِ حسابِ A المؤجَّلُ يصلُ المستهلِكَ ───
      const eventId = "8e6a7f5c-1234-4a5b-9c8d-0e1f2a3b4c5d";
      const consumed = await consumeCoreAccountDeletionEvent(
        {
          inbox,
          repo: customersRepo,
          identity: httpIdentityDeletionPort(),
        },
        {
          event_id: eventId,
          event_type: "core.identity.account.deleted",
          payload: {
            identity_id: genA,
            principal_id: "principal-A",
            deleted_at: clock.now(),
          },
        },
      );
      expect(consumed).toEqual({ kind: "applied", waslaPublicId: wsA });

      // ─── 4. القرارُ ───
      // بياناتُ A المُغطّاةُ زالت: الاسمُ سُطِّحَ والمكانُ حُذفَ.
      const profileA = await customersRepo.findProfile(wsA);
      expect(profileA).not.toBeNull();
      expect(profileA!.displayName).toBeNull();
      expect(await customersRepo.listPlaces(wsA)).toEqual([]);

      // بياناتُ B ووصولُهُ بقيا: الجلسةُ تُصدَرُ والجيلُ يُحلُّ.
      const bSession = await issueSessionViaHttp(telegramT, "init-B");
      expect(bSession.statusCode).toBe(201);
      expect(bSession.waslaPublicId).toBe(wsB);
      const bAgain = await resolveViaHttp({
        telegram_user_id: telegramT,
        core_identity_id: genB,
        source: "customer_bot",
      });
      expect(bAgain.statusCode).toBe(200);
      const bAgainBody = (await bAgain.json()) as { wasla_public_id: string };
      expect(bAgainBody.wasla_public_id).toBe(wsB);

      // جلسةُ A القديمةُ مرفوضةٌ (سُحبَت عندَ التسطيحِ).
      await expect(
        verifySessionToken(
          { sessions: sessionsRepo, repo, clock, idGen },
          aSession.token,
        ),
      ).rejects.toMatchObject({
        code: expect.stringMatching(/UNAUTHENTICATED|EXPIRED/),
      });

      // جيلُ A لا يُحلُّ أبداً — رفضٌ صريحٌ مسمّى.
      const aGhost = await resolveViaHttp({
        telegram_user_id: telegramT,
        core_identity_id: genA,
        source: "customer_bot",
      });
      expect(aGhost.statusCode).toBe(403);
      const aGhostBody = (await aGhost.json()) as { code: string };
      expect(aGhostBody.code).toBe("IDENTITY_CORE_GENERATION_DELETED");

      // التصرّفُ الصريحُ مُسجَّلٌ — قرارُ المالكِ المعلّقُ مكتوبٌ لا مفترضٌ.
      const row = await inbox.find(eventId);
      expect(row).not.toBeNull();
      expect(row!.consumedStatus).toBe("applied");
      expect(row!.disposition).toContain("purged:profile_display_name,saved_places");
      expect(row!.disposition).toContain(
        "retained:order_requests(owner_decision_pending)",
      );

      // إعادةُ إرسالِ الحدثِ = duplicate بلا أثرٍ (الإغلاقُ المفردُ).
      const redelivered = await consumeCoreAccountDeletionEvent(
        {
          inbox,
          repo: customersRepo,
          identity: httpIdentityDeletionPort(),
        },
        {
          event_id: eventId,
          event_type: "core.identity.account.deleted",
          payload: { identity_id: genA },
        },
      );
      expect(redelivered).toEqual({ kind: "duplicate" });
    });

    it("الحدودُ المنشورةُ: قراءةُ الربطِ وتطبيقُ الحذفِ عبرَ مساراتِ HTTP", async () => {
      // جيلٌّ مربوطٌ: القراءةُ تُجيبُ صاحبَهُ.
      const res = await app.inject({
        method: "GET",
        url: "/identity/core-bindings/core-gen-beta",
        headers: signFor("GET", "/identity/core-bindings/core-gen-beta"),
      });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { wasla_public_id: string }).wasla_public_id).toMatch(
        /^WS-/,
      );

      // جيلٌّ غيرُ مربوطٍ: 404 مسمّى لا 500.
      const unbound = await app.inject({
        method: "GET",
        url: "/identity/core-bindings/core-gen-never-crossed",
        headers: signFor(
          "GET",
          "/identity/core-bindings/core-gen-never-crossed",
        ),
      });
      expect(unbound.statusCode).toBe(404);

      // تطبيقُ حذفِ جيلٍّ غيرِ مربوطٍ = قرارٌ قابلٌ للإعادةِ لا تخمينٌ.
      const unapplied = await app.inject({
        method: "POST",
        url: "/identity/core-deletion",
        headers: signFor("POST", "/identity/core-deletion"),
        payload: JSON.stringify({
          core_identity_id: "core-gen-never-crossed",
        }),
      });
      expect(unapplied.statusCode).toBe(200);
      const unappliedBody = (await unapplied.json()) as {
        applied: boolean;
        reason?: string;
      };
      expect(unappliedBody.applied).toBe(false);
      expect(unappliedBody.reason).toBe("unbound");
    });

    it("الحالاتُ المسمّاةُ للمستهلكِ: unbound قابلٌ للإعادةِ وسمٌّ مسمّى", async () => {
      // جيلٌّ لم يعبرِ الجسرَ قطّ: لا حذفَ تخمينيّاً — والصفُّ يبقى حيًّا.
      const outcome = await consumeCoreAccountDeletionEvent(
        {
          inbox,
          repo: customersRepo,
          identity: httpIdentityDeletionPort(),
        },
        {
          event_id: "1f2e3d4c-5b6a-4988-8776-6554433221aa",
          event_type: "core.identity.account.deleted",
          payload: { identity_id: "core-gen-unbound-test" },
        },
      );
      expect(outcome).toEqual({ kind: "unbound" });
      const row = await inbox.find(
        "1f2e3d4c-5b6a-4988-8776-6554433221aa",
      );
      expect(row!.consumedStatus).toBe("error");
      expect(row!.lastError).toBe("unbound");

      // حمولةٌ بلا مفتاحِ حسمٍ = سمٌّ نهائيٌّ مسمّى.
      const poisoned = await consumeCoreAccountDeletionEvent(
        {
          inbox,
          repo: customersRepo,
          identity: httpIdentityDeletionPort(),
        },
        {
          event_id: "2e3d4c5b-6a49-4887-a665-5443322110bb",
          event_type: "core.identity.account.deleted",
          payload: {},
        },
      );
      expect(poisoned).toEqual({
        kind: "poisoned",
        error: "invalid_payload:identity_id_missing",
      });

      // مفتاحُ حدثٍ ليسَ UUID = سمٌّ بمفتاحٍ بديلٍ حتميٍّ (لا يتضاعفُ).
      const badKey = await consumeCoreAccountDeletionEvent(
        {
          inbox,
          repo: customersRepo,
          identity: httpIdentityDeletionPort(),
        },
        {
          event_id: "not-a-uuid",
          event_type: "core.identity.account.deleted",
          payload: { identity_id: "core-gen-x" },
        },
      );
      expect(badKey).toEqual({
        kind: "poisoned",
        error: "invalid_event_id:not_a_uuid",
      });
    });
  },
);
