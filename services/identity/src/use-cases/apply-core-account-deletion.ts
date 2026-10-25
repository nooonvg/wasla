/**
 * applyCoreAccountDeletion — تطبيقُ حدثِ `core.identity.account.deleted` على
 * هويّةِ MARKET (CLM-0701 · استثناءُ ADR-076 المؤرّخُ 2026-10-25).
 *
 * النواةُ تحذفُ حسابَ الجيلِ وتبطلُ جلساتِها، ثمّ تنشرُ الحدثَ — وهذا
 * الاستخدامُ هو النصفُ الثانيّ من الحقيقةِ في MARKET: تحجيرُ هويّةِ الجيلِ
 * (status=deleted) وإبطالُ كلِّ جلساتِها. مُتماثِلُ التكرارِ عمداً: تطبيقٌ
 * ثانٍ لا يُغيّرُ شيئاً (الحجيرُ قائمٌ والجلساتُ مُبطلةٌ).
 *
 * لا ربطَ للجيلِ ⇒ `applied: false` مع `reason: "unbound"` — لا يُطبَّقُ شيءٌ
 * تخميناً (حدثٌ لجيلٍّ لم يعبرِ الجسرَ قطّ)، والحالةُ قابلةٌ للإعادةِ عندَ
 * وصولِ الربطِ. المستهلكُ في خدمةِ الزبائنِ يقرّرُ ماذا يفعلُ بالقرارِ.
 */

import type { ApplyCoreDeletionResponse } from "@wasla/contracts-identity";

import { IdentityError } from "../domain/errors.js";
import type {
  Clock,
  CoreIdentityBindingStore,
  IdentityRepository,
  SessionRepository,
} from "../ports.js";

/** Dependencies injected into the use case (hexagonal wiring). */
export interface ApplyCoreDeletionDeps {
  repo: IdentityRepository;
  sessions: SessionRepository;
  coreBindings: CoreIdentityBindingStore;
  clock: Clock;
  /** Optional correlation id propagated for audit. */
  traceId?: string;
}

/** مُدخَلُ التطبيقِ — من حمولةِ الحدثِ مباشرةً. */
export interface ApplyCoreDeletionInput {
  /** معرّفُ هويةِ النواةِ (identity_id من الحدثِ). */
  readonly coreIdentityId: string;
  /** لحظةُ الحذفِ في النواةِ (من الحدثِ — للتدقيقِ). */
  readonly deletedAt?: string;
}

export async function applyCoreAccountDeletion(
  deps: ApplyCoreDeletionDeps,
  input: ApplyCoreDeletionInput,
): Promise<ApplyCoreDeletionResponse> {
  const { repo, sessions, coreBindings, clock } = deps;

  const coreIdentityId = input.coreIdentityId.trim();
  if (coreIdentityId === "") {
    throw new IdentityError(
      "IDENTITY_ASSERTION_INVALID_REQUEST",
      "core_identity_id is required to apply a CORE account deletion",
    );
  }

  const binding = await coreBindings.findByCoreIdentityId(coreIdentityId);
  if (binding === null) {
    // لا ربطَ لهذا الجيلِ في MARKET — لا يُطبَّقُ شيءٌ تخميناً (قابلٌ للإعادةِ).
    return { applied: false, wasla_public_id: "", reason: "unbound" };
  }

  const user = await repo.findUserByInternalUuid(binding.userInternalUuid);
  if (user === null) {
    // ربطٌ بلا مستخدمٍ = اتساقٌ داخليٌّ مكسورٌ — يُفصَحُ عنهُ لا يُخفى.
    throw new IdentityError(
      "IDENTITY_INTERNAL_ERROR",
      `core binding ${coreIdentityId} points at a missing user`,
    );
  }

  if (user.status === "deleted") {
    // مُتماثِلُ التكرارِ: حُجِّرَ سلفاً (تطبيقٌ سابقٌ ناجحٌ) — لا شيءَ يُعادُ.
    return { applied: true, wasla_public_id: user.waslaPublicId };
  }

  const now = clock.now();

  // 1. تحجيرُ الهويّةِ — القراءةُ تتوقفُ عن رؤيتِها (والتحققُ من الجلساتِ
  //    يرفضُها صراحةً منذَ هذا التغييرِ).
  await repo.updateUserStatus(user.internalUuid, "deleted");
  await repo.recordHistory({
    userInternalUuid: user.internalUuid,
    field: "status",
    oldValue: user.status,
    newValue: "deleted",
    effectiveAt: now,
    source: "system",
  });

  // 2. إبطالُ كلِّ جلساتِ الهويّةِ (الأجهزةُ كلُّها) — أوّلُ سببٍ هو الحقيقةُ
  //    (revokeSession مُتماثِلةُ التكرارِ بنفسِها).
  const live = await sessions.listSessionsForUser(user.internalUuid);
  for (const session of live) {
    if (session.revokedAt === null) {
      await sessions.revokeSession(session.id, now, "core_account_deleted");
    }
  }

  return { applied: true, wasla_public_id: user.waslaPublicId };
}
