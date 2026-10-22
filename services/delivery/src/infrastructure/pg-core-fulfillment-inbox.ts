/**
 * PostgreSQL adapter for the CORE fulfillment inbox (XR-3.5 · contracts/schema.sql).
 *
 * ينفّذُ `CoreFulfillmentInboxStore` على `core_fulfillment_inbox`:
 * - `find` — قراءةٌ بمفتاحِ الحدثِ (uuid) قبلَ أيِّ أثرٍ، للإغلاقِ المفردِ.
 * - `recordTerminal` — `INSERT … ON CONFLICT (event_id) DO UPDATE` في معاملةٍ
 *   واحدةٍ: صفٌّ حيٌّ يُحسَمُ، وصفٌّ نهائيٌّ يُرفضُ تحديثُهُ لأنَّ الشرطَ
 *   `WHERE consumed_status IN ('pending','error')` لا يطابقُهُ فلا يتغيّرُ شيءٌ.
 * - `recordRetryable` — رفعُ `attempt_count` وتسجيلُ الخطأِ الأخيرِ، والصفُّ
 *   يبقى حيًّا للإعادةِ.
 *
 * كلُّ SELECT يعدّدُ أعمدتَهُ صراحةً (خصوصيّةُ ADR-001): لا `SELECT *`.
 */

import type { Pool } from "pg";

import type { CoreFulfillmentInboxRecord, CoreFulfillmentInboxStore } from "../ports.js";

const TERMINAL_STATUSES: readonly string[] = [
  "applied",
  "observed",
  "out_of_order",
  "proof_missing",
  "poisoned",
];

export class PgCoreFulfillmentInbox implements CoreFulfillmentInboxStore {
  constructor(private readonly pool: Pool) {}

  async find(eventId: string): Promise<CoreFulfillmentInboxRecord | null> {
    const result = await this.pool.query(
      `SELECT event_id, event_type, order_reference, consumed_status, last_error, attempt_count
         FROM core_fulfillment_inbox
        WHERE event_id = $1`,
      [eventId],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0]!;
    return {
      eventId: String(row["event_id"]),
      eventType: String(row["event_type"]),
      orderReference: row["order_reference"] === null ? null : String(row["order_reference"]),
      consumedStatus: String(row["consumed_status"]) as CoreFulfillmentInboxRecord["consumedStatus"],
      lastError: row["last_error"] === null ? null : String(row["last_error"]),
      attemptCount: Number(row["attempt_count"]),
    };
  }

  async recordTerminal(cmd: {
    readonly eventId: string;
    readonly eventType: string;
    readonly orderReference: string | null;
    readonly consumedStatus:
      | "applied"
      | "observed"
      | "out_of_order"
      | "proof_missing"
      | "poisoned";
    readonly lastError: string | null;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO core_fulfillment_inbox
         (event_id, event_type, order_reference, consumed_status, last_error, attempt_count)
       VALUES ($1, $2, $3, $4, $5, 1)
       ON CONFLICT (event_id) DO UPDATE
         SET consumed_status = EXCLUDED.consumed_status,
             last_error = EXCLUDED.last_error,
             updated_at = now()
         WHERE core_fulfillment_inbox.consumed_status IN ('pending', 'error')`,
      [
        cmd.eventId,
        cmd.eventType,
        cmd.orderReference,
        cmd.consumedStatus,
        cmd.lastError,
      ],
    );
  }

  async recordRetryable(eventId: string, lastError: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO core_fulfillment_inbox
         (event_id, event_type, order_reference, consumed_status, last_error, attempt_count)
       VALUES ($1, 'core.fulfillment.unknown', NULL, 'error', $2, 1)
       ON CONFLICT (event_id) DO UPDATE
         SET attempt_count = core_fulfillment_inbox.attempt_count + 1,
             last_error = EXCLUDED.last_error,
             updated_at = now()
         WHERE core_fulfillment_inbox.consumed_status IN ('pending', 'error')`,
      [eventId, lastError],
    );
  }
}

export { TERMINAL_STATUSES };
