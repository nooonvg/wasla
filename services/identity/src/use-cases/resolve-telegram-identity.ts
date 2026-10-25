/**
 * resolveTelegramIdentity use case.
 *
 * Idempotent by `telegram_user_id` (per OpenAPI POST /identity/resolve):
 *  - If the Telegram id is already linked to a user, resolve to that user.
 *  - A changed `telegram_username` does NOT create a new user — it is recorded
 *    in Identity History and a TelegramUsernameChanged event is emitted.
 *  - If no user exists, create one (new Wasla Public ID + internal_uuid),
 *    add the Telegram link, record the initial username, and emit
 *    IdentityCreated + IdentityLinkAdded events to the outbox.
 *
 * This is the core of the Phase 01 Exit Gate: "create a user from Telegram
 * and identity stays stable across Username change."
 *
 * ## التسويةُ الواعيةُ بالأجيالِ (CLM-0701 · استثناءُ ADR-076 المؤرّخُ 2026-10-25)
 *
 * حينَ يحملُ الطلبُ `core_identity_id` (جيلُ الحسابِ المصادَقُ عليهِ من جسرِ
 * الويب — النواةُ تحرّرُ المفتاحَ عندَ الحذفِ فإعادةُ التسجيلِ جيلٌّ جديدٌ)،
 * تصبحُ الهويّةُ ملكَ الجيلِ لا ملكَ القناةِ:
 *  - الجيلُ مربوطٌ سلفاً ← هويّتُهُ (لا إنشاءَ ولا تحريكَ).
 *  - القناةُ مربوطةٌ بهويّةٍ غيرِ مربوطةٍ بجيلٍّ (عصرُ البوت) ← أوّلُ ربطٍ لها.
 *  - القناةُ مربوطةٌ بهويّةِ جيلٍّ آخرَ ← **جيلٌّ جديدٌ**: هويّةُ MARKET جديدةٌ
 *    فارغةٌ ترثُ رابطَ القناةِ (فمسارُ البوتِ يجدُها)، والجيلُ القديمُ يفقدُهُ
 *    وربطُهُ يُزاحُ. البياناتُ لا تُورَّثُ بينَ الأجيالِ.
 *  - الجيلُ المحجّرُ (حُذفَ حسابُهُ في النواة) لا يُعادُ ربطُهُ — رفضٌ صريحٌ.
 */

import type {
  ResolveIdentityRequest,
  ResolveIdentityResponse,
  IdentityLink as IdentityLinkDto,
} from "@wasla/contracts-identity";

import { IdentityError } from "../domain/errors.js";
import { formatWaslaPublicId } from "../domain/public-id.js";
import {
  identityCreated,
  identityLinkAdded,
  telegramUsernameChanged,
  type CreationSource,
} from "../domain/events.js";
import type { IdentityLink, User } from "../domain/model.js";
import type {
  Clock,
  CoreIdentityBindingStore,
  IdGenerator,
  IdentityRepository,
  Outbox,
  PublicIdSequence,
} from "../ports.js";

/** Shared dependencies injected into use cases (hexagonal wiring). */
export interface UseCaseDeps {
  repo: IdentityRepository;
  outbox: Outbox;
  publicIdSeq: PublicIdSequence;
  clock: Clock;
  idGen: IdGenerator;
  /** Optional correlation id propagated into event envelopes. */
  traceId?: string;
  /**
   * مخزنُ ربطِ الأجيالِ (CLM-0701) — اختياريٌّ لبقاءِ الأسلاكِ القديمةِ صالحةً:
   * الطلباتُ بلا `core_identity_id` لا تلمسُهُ أبداً؛ وحضورُهُ في طلبٍ بلا
   * مخزنٍ خطأُ إعدادٍ يُفصَحُ عنهُ لا يُتجاهَلُ صامتاً.
   */
  coreBindings?: CoreIdentityBindingStore;
}

function toLinkDto(link: IdentityLink): IdentityLinkDto {
  return {
    provider: link.provider,
    external_id: link.externalId,
    verified: link.verified,
    linked_at: link.linkedAt,
  };
}

/** Resolve the source for creation/history from the request (default customer_bot). */
function resolveSource(
  source: ResolveIdentityRequest["source"],
): CreationSource {
  return source ?? "customer_bot";
}

export async function resolveTelegramIdentity(
  deps: UseCaseDeps,
  request: ResolveIdentityRequest,
): Promise<ResolveIdentityResponse> {
  const { repo } = deps;

  // 1. Validate the idempotent key.
  if (
    request.telegram_user_id === undefined ||
    request.telegram_user_id === null ||
    !Number.isFinite(request.telegram_user_id)
  ) {
    throw new IdentityError(
      "IDENTITY_MISSING_TELEGRAM_ID",
      "telegram_user_id is required to resolve a Wasla identity",
    );
  }

  const telegramExternalId = String(request.telegram_user_id);

  // 2. التسويةُ الواعيةُ بالأجيالِ (CLM-0701): حينَ يحملُ الطلبُ جيلَ الحسابِ
  //    المصادَقَ عليهِ من النواةِ، ملكيّةُ الهويّةِ للجيلِ لا للقناةِ.
  const coreIdentityId =
    typeof request.core_identity_id === "string"
      ? request.core_identity_id.trim()
      : "";
  if (coreIdentityId !== "") {
    return resolveWithCoreGeneration(deps, request, telegramExternalId, coreIdentityId);
  }

  // 3. Idempotent resolve: existing user for this Telegram id.
  const existing = await repo.findUserByTelegramId(telegramExternalId);
  if (existing) {
    await recordUsernameChange(deps, existing, request);

    const links = await repo.listLinks(existing.internalUuid);
    return {
      wasla_public_id: existing.waslaPublicId,
      internal_uuid: existing.internalUuid,
      created: false,
      links: links.map(toLinkDto),
    };
  }

  // 4. Create a new Wasla identity.
  const fresh = await createFreshIdentity(deps, request, telegramExternalId);
  return fresh;
}

/**
 * تسجيلُ تغيّرِ اسمِ المستخدمِ على تيليجرامَ (لا يُنشئُ هويّةً — سجلُّ تدقيقٍ فقط).
 * مشتركٌ بينَ المسارَينِ القديمِ والواعيِ بالأجيالِ.
 */
async function recordUsernameChange(
  deps: UseCaseDeps,
  user: User,
  request: ResolveIdentityRequest,
): Promise<void> {
  const { repo, outbox, clock, idGen, traceId } = deps;
  const latestUsername = await repo.latestTelegramUsername(user.internalUuid);
  const incomingUsername = request.telegram_username ?? null;

  if (incomingUsername !== null && incomingUsername !== latestUsername) {
    const now = clock.now();
    const source = resolveSource(request.source);
    await repo.recordHistory({
      userInternalUuid: user.internalUuid,
      field: "telegram_username",
      oldValue: latestUsername,
      newValue: incomingUsername,
      effectiveAt: now,
      source,
    });
    await outbox.append(
      telegramUsernameChanged({
        idGen,
        clock,
        aggregateId: user.internalUuid,
        oldUsername: latestUsername,
        newUsername: incomingUsername,
        source,
        traceId,
      }),
    );
  }
}

/** إنشاءُ هويّةِ MARKET جديدةٍ برابطِ القناةِ — مشتركٌ بينَ المسارَينِ. */
async function createFreshIdentity(
  deps: UseCaseDeps,
  request: ResolveIdentityRequest,
  telegramExternalId: string,
): Promise<ResolveIdentityResponse> {
  const { repo, outbox, publicIdSeq, clock, idGen, traceId } = deps;
  const publicIdNumber = await publicIdSeq.next();
  const waslaPublicId = formatWaslaPublicId(publicIdNumber);
  const internalUuid = idGen.uuid();
  const now = clock.now();
  const source = resolveSource(request.source);

  await repo.createUser({
    internalUuid,
    waslaPublicId,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  await repo.addLink({
    userInternalUuid: internalUuid,
    provider: "telegram",
    externalId: telegramExternalId,
    verified: true,
    linkedAt: now,
  });

  if (request.telegram_username) {
    await repo.recordHistory({
      userInternalUuid: internalUuid,
      field: "telegram_username",
      oldValue: null,
      newValue: request.telegram_username,
      effectiveAt: now,
      source,
    });
  }

  // Emit domain events to the outbox.
  await outbox.append(
    identityCreated({
      idGen,
      clock,
      aggregateId: internalUuid,
      waslaPublicId,
      source,
      traceId,
    }),
  );
  await outbox.append(
    identityLinkAdded({
      idGen,
      clock,
      aggregateId: internalUuid,
      provider: "telegram",
      externalId: telegramExternalId,
      verified: true,
      traceId,
    }),
  );

  const links = await repo.listLinks(internalUuid);
  return {
    wasla_public_id: waslaPublicId,
    internal_uuid: internalUuid,
    created: true,
    links: links.map(toLinkDto),
  };
}

/**
 * إنشاءُ هويّةٍ جديدةٍ **بنقلِ** رابطِ القناةِ القائمِ إليها (جيلٌّ جديدٌ يرثُ
 * القناةَ). يستعملُهُ المسارُ الواعي بالأجيالِ فقط: القيدُ الفريدُ على
 * (provider, external_id) يجعلُ الإنشاءَ بنسخةٍ ثانيةٍ من الرابطِ مستحيلاً —
 * فالنقلُ هو الطريقُ.
 */
async function createFreshIdentityWithMovedLink(
  deps: UseCaseDeps,
  request: ResolveIdentityRequest,
  telegramExternalId: string,
): Promise<ResolveIdentityResponse> {
  const { repo, outbox, publicIdSeq, clock, idGen, traceId } = deps;
  const publicIdNumber = await publicIdSeq.next();
  const waslaPublicId = formatWaslaPublicId(publicIdNumber);
  const internalUuid = idGen.uuid();
  const now = clock.now();
  const source = resolveSource(request.source);

  await repo.createUser({
    internalUuid,
    waslaPublicId,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  // نقلُ الرابطِ (لا إنشاءَ ثانٍ): الجيلُ القديمُ يفقدُ القناةَ نهائياً.
  await repo.reassignLink({
    provider: "telegram",
    externalId: telegramExternalId,
    toUserInternalUuid: internalUuid,
    linkedAt: now,
  });

  if (request.telegram_username) {
    await repo.recordHistory({
      userInternalUuid: internalUuid,
      field: "telegram_username",
      oldValue: null,
      newValue: request.telegram_username,
      effectiveAt: now,
      source,
    });
  }

  await outbox.append(
    identityCreated({
      idGen,
      clock,
      aggregateId: internalUuid,
      waslaPublicId,
      source,
      traceId,
    }),
  );
  await outbox.append(
    identityLinkAdded({
      idGen,
      clock,
      aggregateId: internalUuid,
      provider: "telegram",
      externalId: telegramExternalId,
      verified: true,
      traceId,
    }),
  );

  const links = await repo.listLinks(internalUuid);
  return {
    wasla_public_id: waslaPublicId,
    internal_uuid: internalUuid,
    created: true,
    links: links.map(toLinkDto),
  };
}

/**
 * المسارُ الواعي بالأجيالِ (CLM-0701) — الهويّةُ ملكُ الجيلِ لا القناةِ.
 *
 * أربعُ حالاتٍ لا خامسَ لها (كلُّ واحدةٍ مُسمّاةٌ ومُختبَرةٌ):
 *  1. الجيلُ مربوطٌ ← هويّتُهُ (رفضٌ صريحٌ إن كانَ محجّراً).
 *  2. لا ربطَ للجيلِ، والقناةُ لهويّةٍ مربوطةٍ بجيلٍّ آخرَ ← جيلٌّ جديدٌ:
 *     هويّةٌ جديدةٌ ترثُ القناةَ، وربطُ الجيلِ القديمِ يُزاحُ.
 *  3. لا ربطَ للجيلِ، والقناةُ لهويّةٍ بلا ربطٍ (عصرُ البوت) ← أوّلُ ربطٍ لها.
 *  4. لا ربطَ ولا قناةَ ← إنشاءٌ وربطٌ.
 */
async function resolveWithCoreGeneration(
  deps: UseCaseDeps,
  request: ResolveIdentityRequest,
  telegramExternalId: string,
  coreIdentityId: string,
): Promise<ResolveIdentityResponse> {
  const { repo, clock, coreBindings } = deps;

  if (coreBindings === undefined) {
    // خطأُ إعدادٍ لا تجاهلٌ صامتٌ: جسرٌ يُقدّمُ جيلاً بلا مخزنِ ربطٍ.
    throw new IdentityError(
      "IDENTITY_CORE_BINDING_UNAVAILABLE",
      "core_identity_id requires a CoreIdentityBindingStore — the wiring is missing it",
    );
  }

  // الحالةُ 1: الجيلُ مربوطٌ سلفاً.
  const bound = await coreBindings.findByCoreIdentityId(coreIdentityId);
  if (bound !== null) {
    const user = await repo.findUserByInternalUuid(bound.userInternalUuid);
    if (user === null) {
      // اتساقٌ داخليٌّ مكسورٌ (ربطٌ بلا مستخدمٍ) — يُفصَحُ عنهُ لا يُخفى.
      throw new IdentityError(
        "IDENTITY_INTERNAL_ERROR",
        `core binding ${coreIdentityId} points at a missing user`,
      );
    }
    if (user.status === "deleted") {
      // الجيلُ المحجّرُ لا يُعادُ ربطُهُ: النواةُ أبطلت حسابَهُ وجلساتِهِ.
      throw new IdentityError(
        "IDENTITY_CORE_GENERATION_DELETED",
        "this CORE account generation was deleted; it may not resolve again",
      );
    }
    await recordUsernameChange(deps, user, request);
    const links = await repo.listLinks(user.internalUuid);
    return {
      wasla_public_id: user.waslaPublicId,
      internal_uuid: user.internalUuid,
      created: false,
      links: links.map(toLinkDto),
    };
  }

  // لا ربطَ للجيلِ — ماذا عنِ القناةِ؟
  const channelUser = await repo.findUserByTelegramId(telegramExternalId);

  if (channelUser !== null) {
    const channelBinding = await coreBindings.findLatestForUserInternalUuid(
      channelUser.internalUuid,
    );

    if (channelBinding !== null) {
      // الحالةُ 2: جيلٌّ جديدٌ — القناةُ كانت لهويّةِ جيلٍّ آخرَ.
      // هويّةٌ جديدةٌ **تَرِثُ رابطَ القناةِ** (نقلٌ لا إنشاءٌ: القيدُ الفريدُ
      // (provider, external_id) لا يقبلُ رابطينِ)، فمسارُ البوتِ القديمُ يجدُ
      // الجيلَ الجديدَ، والجيلُ القديمُ يفقدُ القناةَ وربطُهُ يُزاحُ.
      const fresh = await createFreshIdentityWithMovedLink(
        deps,
        request,
        telegramExternalId,
      );
      const now = clock.now();

      await coreBindings.supersede(
        channelBinding.coreIdentityId,
        coreIdentityId,
        now,
      );
      const freshUser = await repo.findUserByPublicId(fresh.wasla_public_id);
      if (freshUser === null) {
        throw new IdentityError(
          "IDENTITY_INTERNAL_ERROR",
          "fresh identity disappeared immediately after creation",
        );
      }
      await coreBindings.bind({
        coreIdentityId,
        userInternalUuid: freshUser.internalUuid,
        waslaPublicId: freshUser.waslaPublicId,
        boundAt: now,
      });
      return fresh;
    }

    // الحالةُ 3: أوّلُ ربطٍ لهويّةِ عصرِ البوت.
    const now = clock.now();
    await coreBindings.bind({
      coreIdentityId,
      userInternalUuid: channelUser.internalUuid,
      waslaPublicId: channelUser.waslaPublicId,
      boundAt: now,
    });
    await recordUsernameChange(deps, channelUser, request);
    const links = await repo.listLinks(channelUser.internalUuid);
    return {
      wasla_public_id: channelUser.waslaPublicId,
      internal_uuid: channelUser.internalUuid,
      created: false,
      links: links.map(toLinkDto),
    };
  }

  // الحالةُ 4: لا ربطَ ولا قناةَ — إنشاءٌ وربطٌ.
  const fresh = await createFreshIdentity(deps, request, telegramExternalId);
  const now = clock.now();
  const freshUser = await repo.findUserByPublicId(fresh.wasla_public_id);
  if (freshUser === null) {
    throw new IdentityError(
      "IDENTITY_INTERNAL_ERROR",
      "fresh identity disappeared immediately after creation",
    );
  }
  await coreBindings.bind({
    coreIdentityId,
    userInternalUuid: freshUser.internalUuid,
    waslaPublicId: freshUser.waslaPublicId,
    boundAt: now,
  });
  return fresh;
}
