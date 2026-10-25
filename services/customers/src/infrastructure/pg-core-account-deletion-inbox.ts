/**
 * PostgreSQL adapter for the CORE account deletion inbox (CLM-0701).
 *
 * ينفّذُ `CoreAccountDeletionInboxStore` على `core_account_deletion_inbox`:
 * - `find` — قراءةٌ بمفتاحِ الحدثِ (uuid) قبلَ أيِّ أثرٍ، للإغلاقِ المفردِ.
 * - `recordTerminal` — `INSERT … ON CONFLICT (event_id) DO UPDATE` بشرطِ أنّ
 *   الصفَّ حيٌّ: صفٌّ نهائيٌّ لا يُخفَّضُ إلى حالةٍ حيّةٍ (عقدُ الصندوقِ).
 * - `recordRetryable` — رفعُ `attempt_count` وتسجيلُ الخطأِ الأخيرِ، والصفُّ
 *   يبقى حيًّا للإعادةِ.
 *
 * كلُّ SELECT يعدّدُ أعمدتَهُ صراحةً (خصوصيّةُ ADR-001): لا `SELECT *`.
 */

import type { Pool } from "pg";

import type {
  CoreAccountDeletionInboxRecord,
  CoreAccountDeletionInboxStore,
} from "../ports.js";

export class PgCoreAccountDeletionInbox
  implements CoreAccountDeletionInboxStore
{
  constructor(private readonly pool: Pool) {}

  async find(eventId: string): Promise<CoreAccountDeletionInboxRecord | null> {
    const result = await this.pool.query(
      `SELECT event_id, event_type, core_identity_id, consumed_status,
              last_error, attempt_count, disposition, consumed_at, updated_at
         FROM core_account_deletion_inbox
        WHERE event_id = $1`,
      [eventId],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0]!;
    return {
      eventId: String(row["event_id"]),
      eventType: String(row["event_type"]),
      coreIdentityId: row["core_identity_id"] === null ? null : String(row["core_identity_id"]),
      consumedStatus: String(row["consumed_status"]) as CoreAccountDeletionInboxRecord["consumedStatus"],
      lastError: row["last_error"] === null ? null : String(row["last_error"]),
      attemptCount: Number(row["attempt_count"]),
      disposition: row["disposition"] === null ? null : String(row["disposition"]),
      consumedAt: new Date(row["consumed_at"]).toISOString(),
      updatedAt: new Date(row["updated_at"]).toISOString(),
    };
  }

  async recordTerminal(cmd: {
    readonly eventId: string;
    readonly eventType: string;
    readonly coreIdentityId: string | null;
    readonly consumedStatus: "applied" | "observed" | "poisoned";
    readonly lastError: string | null;
    readonly disposition: string | null;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO core_account_deletion_inbox
         (event_id, event_type, core_identity_id, consumed_status, last_error,
          attempt_count, disposition)
       VALUES ($1, $2, $3, $4, $5, 1, $6)
       ON CONFLICT (event_id) DO UPDATE
         SET consumed_status = EXCLUDED.consumed_status,
             last_error = EXCLUDED.last_error,
             disposition = EXCLUDED.disposition,
             updated_at = now()
         WHERE core_account_deletion_inbox.consumed_status IN ('pending', 'error')`,
      [
        cmd.eventId,
        cmd.eventType,
        cmd.coreIdentityId,
        cmd.consumedStatus,
        cmd.lastError,
        cmd.disposition,
      ],
    );
  }

  async recordRetryable(eventId: string, lastError: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO core_account_deletion_inbox
         (event_id, event_type, core_identity_id, consumed_status, last_error,
          attempt_count, disposition)
       VALUES ($1, 'core.identity.account.deleted', NULL, 'error', $2, 1, NULL)
       ON CONFLICT (event_id) DO UPDATE
         SET attempt_count = core_account_deletion_inbox.attempt_count + 1,
             last_error = EXCLUDED.last_error,
             updated_at = now()
         WHERE core_account_deletion_inbox.consumed_status IN ('pending', 'error')`,
      [eventId, lastError],
    );
  }
}
