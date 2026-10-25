import { describe, it, expect, beforeEach } from "vitest";

import {
  InMemoryCoreIdentityBindingStore,
  InMemoryIdentityRepository,
  InMemoryOutbox,
  InMemoryPublicIdSequence,
  SystemClock,
  CryptoIdGenerator,
  resolveTelegramIdentity,
  WASLA_PUBLIC_ID_PATTERN,
  type UseCaseDeps,
} from "../index.js";

function makeDeps(): { deps: UseCaseDeps; outbox: InMemoryOutbox; repo: InMemoryIdentityRepository } {
  const repo = new InMemoryIdentityRepository();
  const outbox = new InMemoryOutbox();
  const deps: UseCaseDeps = {
    repo,
    outbox,
    publicIdSeq: new InMemoryPublicIdSequence(),
    clock: new SystemClock(),
    idGen: new CryptoIdGenerator(),
  };
  return { deps, outbox, repo };
}

describe("resolveTelegramIdentity — Phase 01 Exit Gate", () => {
  let harness: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    harness = makeDeps();
  });

  it("creates a new Wasla identity from a Telegram user", async () => {
    const { deps, outbox } = harness;
    const res = await resolveTelegramIdentity(deps, {
      telegram_user_id: 111222333,
      telegram_username: "saud",
      source: "customer_bot",
    });

    expect(res.created).toBe(true);
    expect(res.wasla_public_id).toMatch(WASLA_PUBLIC_ID_PATTERN);
    expect(res.internal_uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.links ?? []).toHaveLength(1);
    expect((res.links ?? [])[0]).toMatchObject({
      provider: "telegram",
      external_id: "111222333",
      verified: true,
    });

    // events: identity.created + identity.link.added
    const events = await outbox.unread();
    expect(events.map((e) => e.event_type)).toEqual([
      "identity.created",
      "identity.link.added",
    ]);
    expect(events[0].producer).toBe("identity-service");
    expect(events[0].aggregate).toEqual({ type: "user", id: res.internal_uuid });
  });

  it("is idempotent: resolving the same telegram id returns the same user", async () => {
    const { deps, outbox } = harness;
    const first = await resolveTelegramIdentity(deps, {
      telegram_user_id: 111222333,
      telegram_username: "saud",
      source: "customer_bot",
    });
    outbox.drain();

    const second = await resolveTelegramIdentity(deps, {
      telegram_user_id: 111222333,
      telegram_username: "saud",
      source: "customer_bot",
    });

    expect(second.created).toBe(false);
    expect(second.wasla_public_id).toBe(first.wasla_public_id);
    expect(second.internal_uuid).toBe(first.internal_uuid);
    // no new events on an unchanged username
    expect(await outbox.unread()).toHaveLength(0);
  });

  it("keeps the identity stable across a Telegram username change", async () => {
    const { deps, outbox, repo } = harness;
    const first = await resolveTelegramIdentity(deps, {
      telegram_user_id: 111222333,
      telegram_username: "saud",
      source: "customer_bot",
    });
    outbox.drain();

    const second = await resolveTelegramIdentity(deps, {
      telegram_user_id: 111222333,
      telegram_username: "saud_v2",
      source: "customer_bot",
    });

    // Same identity, same public id — only the username changed.
    expect(second.created).toBe(false);
    expect(second.wasla_public_id).toBe(first.wasla_public_id);
    expect(second.internal_uuid).toBe(first.internal_uuid);

    // A username-change history entry was recorded + event emitted.
    const events = await outbox.unread();
    expect(events.map((e) => e.event_type)).toEqual([
      "identity.telegram_username.changed",
    ]);
    const history = await repo.listHistory(
      first.internal_uuid,
      "telegram_username",
    );
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ oldValue: null, newValue: "saud" });
    expect(history[1]).toMatchObject({ oldValue: "saud", newValue: "saud_v2" });
  });

  it("stays stable across multiple username changes, recording full history", async () => {
    const { deps, repo } = harness;
    const base = await resolveTelegramIdentity(deps, {
      telegram_user_id: 999,
      telegram_username: "u1",
      source: "driver_bot",
    });

    for (const next of ["u2", "u3", "u4"]) {
      const res = await resolveTelegramIdentity(deps, {
        telegram_user_id: 999,
        telegram_username: next,
        source: "driver_bot",
      });
      expect(res.wasla_public_id).toBe(base.wasla_public_id);
      expect(res.internal_uuid).toBe(base.internal_uuid);
    }

    const history = await repo.listHistory(
      base.internal_uuid,
      "telegram_username",
    );
    expect(history.map((h) => h.newValue)).toEqual(["u1", "u2", "u3", "u4"]);
    expect(history[0].oldValue).toBeNull();
    expect(history[1].oldValue).toBe("u1");
  });

  it("rejects a resolve without a telegram_user_id", async () => {
    const { deps } = harness;
    await expect(
      resolveTelegramIdentity(deps, {
        telegram_user_id: undefined as unknown as number,
        source: "customer_bot",
      }),
    ).rejects.toMatchObject({ code: "IDENTITY_MISSING_TELEGRAM_ID" });
  });
});
describe("resolveTelegramIdentity — تسويةُ الأجيالِ (CLM-0701 · استثناءُ ADR-076)", () => {
  let harness: ReturnType<typeof makeDeps>;
  let coreBindings: InMemoryCoreIdentityBindingStore;

  beforeEach(() => {
    harness = makeDeps();
    coreBindings = new InMemoryCoreIdentityBindingStore();
    harness.deps.coreBindings = coreBindings;
  });

  it("الحالةُ 4: لا ربطَ ولا قناةَ — إنشاءٌ وربطُ الجيلِ بهويّتِهِ", async () => {
    const { deps } = harness;
    const res = await resolveTelegramIdentity(deps, {
      telegram_user_id: 700,
      telegram_username: "gen_user",
      core_identity_id: "core-gen-fresh",
      source: "customer_bot",
    });
    expect(res.created).toBe(true);
    const binding = await coreBindings.findByCoreIdentityId("core-gen-fresh");
    expect(binding).not.toBeNull();
    expect(binding!.waslaPublicId).toBe(res.wasla_public_id);
  });

  it("الحالةُ 1: الجيلُ مربوطٌ ⇒ هويّتُهُ (إيدمبوtenسي)", async () => {
    const { deps } = harness;
    const first = await resolveTelegramIdentity(deps, {
      telegram_user_id: 701,
      telegram_username: "bound_user",
      core_identity_id: "core-gen-bound",
      source: "customer_bot",
    });
    const again = await resolveTelegramIdentity(deps, {
      telegram_user_id: 701,
      telegram_username: "bound_user",
      core_identity_id: "core-gen-bound",
      source: "customer_bot",
    });
    expect(again.created).toBe(false);
    expect(again.wasla_public_id).toBe(first.wasla_public_id);
  });

  it("الحالةُ 1 المحذوفة: جيلٌ مربوطٌ محذوفٌ ⇒ رفضٌ صريحٌ لا تحويلَ", async () => {
    const { deps, repo } = harness;
    const first = await resolveTelegramIdentity(deps, {
      telegram_user_id: 702,
      telegram_username: "doomed_user",
      core_identity_id: "core-gen-doomed",
      source: "customer_bot",
    });
    const user = await repo.findUserByPublicId(first.wasla_public_id);
    expect(user).not.toBeNull();
    await repo.updateUserStatus(user!.internalUuid, "deleted");
    await expect(
      resolveTelegramIdentity(deps, {
        telegram_user_id: 702,
        telegram_username: "doomed_user",
        core_identity_id: "core-gen-doomed",
        source: "customer_bot",
      }),
    ).rejects.toMatchObject({ code: "IDENTITY_CORE_GENERATION_DELETED" });
  });

  it("الحالةُ 2: جيلٌ جديدٌ على قناةِ جيلٍ سابقٍ ⇒ مفتاحٌ طازجٌ ونقلُ الرابطِ وإزاحةُ القديمِ", async () => {
    const { deps, repo } = harness;
    const a = await resolveTelegramIdentity(deps, {
      telegram_user_id: 703,
      telegram_username: "shared_channel",
      core_identity_id: "core-gen-old",
      source: "customer_bot",
    });
    const b = await resolveTelegramIdentity(deps, {
      telegram_user_id: 703,
      telegram_username: "shared_channel",
      core_identity_id: "core-gen-new",
      source: "customer_bot",
    });
    // مفتاحانِ مختلفانِ — لا إرثَ للجيلِ الجديدِ.
    expect(b.created).toBe(true);
    expect(b.wasla_public_id).not.toBe(a.wasla_public_id);
    // الرابطُ انتقلَ: القناةُ مالكٌ واحدٌ في كلِّ لحظةٍ.
    const owner = await repo.findUserByTelegramId("703");
    expect(owner?.waslaPublicId).toBe(b.wasla_public_id);
    // ربطُ الجيلِ القديمِ زُوحَ.
    const oldBinding = await coreBindings.findLatestForUserInternalUuid(
      (await repo.findUserByPublicId(a.wasla_public_id))!.internalUuid,
    );
    expect(oldBinding).not.toBeNull();
    expect(oldBinding!.supersededByCoreIdentityId).toBe("core-gen-new");
    // والجيلُ الجديدُ مربوطٌ.
    const newBinding = await coreBindings.findByCoreIdentityId("core-gen-new");
    expect(newBinding?.waslaPublicId).toBe(b.wasla_public_id);
  });

  it("الحالةُ 3: قناةُ عهدِ البوتِ بلا جيلٍ ⇒ أوّلُ ربطٍ لا إنشاءَ", async () => {
    const { deps } = harness;
    const legacy = await resolveTelegramIdentity(deps, {
      telegram_user_id: 704,
      telegram_username: "bot_era_user",
      source: "customer_bot",
    });
    const bound = await resolveTelegramIdentity(deps, {
      telegram_user_id: 704,
      telegram_username: "bot_era_user",
      core_identity_id: "core-gen-first",
      source: "customer_bot",
    });
    expect(bound.created).toBe(false);
    expect(bound.wasla_public_id).toBe(legacy.wasla_public_id);
    const binding = await coreBindings.findByCoreIdentityId("core-gen-first");
    expect(binding?.waslaPublicId).toBe(legacy.wasla_public_id);
  });

  it("جيلٌ بلا مخزنِ ربطٍ ⇒ خطأُ إعدادٍ لا تجاهلٌ صامتٌ", async () => {
    const { deps } = harness;
    delete deps.coreBindings;
    await expect(
      resolveTelegramIdentity(deps, {
        telegram_user_id: 705,
        telegram_username: "unwired",
        core_identity_id: "core-gen-unwired",
        source: "customer_bot",
      }),
    ).rejects.toMatchObject({ code: "IDENTITY_CORE_BINDING_UNAVAILABLE" });
  });

  it("القديمُ لا يتغيّرُ: طلبٌ بلا جيلٍ لا يلمسُ مخزنَ الربطِ", async () => {
    const { deps } = harness;
    const res = await resolveTelegramIdentity(deps, {
      telegram_user_id: 706,
      telegram_username: "legacy_only",
      source: "customer_bot",
    });
    expect(res.created).toBe(true);
    const all = await coreBindings.findLatestForUserInternalUuid(
      res.internal_uuid,
    );
    expect(all).toBeNull();
  });
});
