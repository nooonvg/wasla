# Supabase connector readings — 2026-10-14 (read-only)

## source: supabase MCP connector execute_sql + query_logs
## collected_at: 2026-10-14T02:35Z – 02:55Z (UTC)

### production project (ppixaauyqoykrogwdxtv)

| Measurement | Value | Method / source timestamp |
|---|---|---|
| Project status | ACTIVE_HEALTHY | list_projects @ 2026-10-14T02:35Z |
| `max_connections` (PostgreSQL) | 60 | execute_sql `SELECT max(setting) FROM pg_settings WHERE name='max_connections'` @ 2026-10-14T02:37Z |
| pg_stat_activity total rows | 14 (6 idle + 1 active + 7 state NULL) | execute_sql `SELECT ... count(*) FROM pg_stat_activity` @ 2026-10-14T02:37Z |
| named_app_sessions rows (non-empty application_name) | 6 | execute_sql same query @ 2026-10-14T02:37Z |
| application_name breakdown | pgbouncer(idle)·PostgREST 14.18·pg_net 0.20.4·pg_cron scheduler·Supabase Storage API·postgres_exporter·mgmt-api(active) | execute_sql `SELECT application_name, usename, state, count(*) FROM pg_stat_activity GROUP BY 1,2,3 ORDER BY 4 DESC` @ 2026-10-14T02:37Z |
| WASLA services in pg_stat_activity | none observed at this snapshot | execute_sql same query @ 2026-10-14T02:37Z |
| supavisor_logs available sources | supavisor_logs·realtime_logs·edge_logs·pgbouncer_logs | query_logs `SELECT DISTINCT source FROM logs` @ 2026-10-14T02:38Z |
| EMAXCONNSESSION matches in requested window 2026-10-13T07:00Z → 2026-10-14T07:00Z | 0 | query_logs `SELECT count() FROM logs WHERE source='supavisor_logs' AND (event_message ilike '%EMAXCONNSESSION%' OR event_message ilike '%maxconn%')` @ 2026-10-14T02:39Z |
| supavisor_logs total lines in same requested window | 164 | query_logs `SELECT count() FROM logs WHERE source='supavisor_logs'` @ 2026-10-14T02:40Z |
| supavisor_logs first_t / last_t | 2026-10-13T14:18:19.921675Z / 2026-10-13T23:06:10.526333Z | query_logs `SELECT min(timestamp), max(timestamp) FROM logs WHERE source='supavisor_logs'` @ 2026-10-14T02:41Z |
| Latest 5 supavisor_log event_messages | `ClientHandler: Terminate received from client` ×3, `No subscribers for pool Supavisor.id(...) shutting down`, `Pool Supavisor.id(...) shutting down gracefully` | query_logs `SELECT event_message, timestamp FROM logs WHERE source='supavisor_logs' ORDER BY timestamp DESC LIMIT 5` @ 2026-10-14T02:42Z |
| `default_pool_size` (Supavisor internal) | NOT MEASURED — no admin endpoint exposed by the Supabase MCP connector; `pg_settings` does not expose it (Supavisor is separate from PostgreSQL) | — |
| `EMAXCONNSESSION` in a complete continuous production coverage window | NOT MEASURED — the requested 24h window returned only 164 lines spanning 2026-10-13T14:18:19.921675Z → 23:06:10.526333Z; that gap is not a proven continuous coverage | see above |

### DR project (pvyuhjadrygqqdoczmnd)

| Measurement | Value | Method / source timestamp |
|---|---|---|
| Project status | INACTIVE | list_projects @ 2026-10-14T02:35Z |
| max_connections / default_pool_size | NOT MEASURED — project INACTIVE, no SQL reachable | list_projects @ 2026-10-14T02:35Z |

## interpretation notes (recorded honestly, no over-claiming)

1. The pg_stat_activity snapshot shows 14 rows total (6 idle + 1 active + 7 state NULL), not 14 active sessions. `max_connections=60` is the PostgreSQL limit, not a Supavisor session limit and not a capacity headroom.
2. The absence of a WASLA-named application_name in this single snapshot does not prove the Render fleet is not connected. The application_name value depends on the pg driver configuration of each service. A continuous coverage window is needed to assert absence.
3. The EMAXCONNSESSION=0 result applies to the specific 164-line coverage window 2026-10-13T14:18:19.921675Z → 23:06:10.526333Z, not to a continuous production coverage window. Absence of a match in that window is not proof of absence elsewhere.
4. The Supabase MCP connector exposes only list_projects/get_project/execute_sql/query_logs. There is no admin API to read `default_pool_size` without the Supabase dashboard or a management API token. This is a real blocker on owner-grantable tooling, not something to fabricate.
