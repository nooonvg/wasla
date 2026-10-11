# CLM-0525 (تابع CLM-0524) — ADR-069 المرحلة 2 الجزء 2: حزمة الحد، تركيب البوتين، تهيئة الجلسة، سقالة الأدلة

## النطاق المنفَّذ (بلا تغيير قائمة السماح ولا أي إعداد إنتاجي)

### 1 · حزمة `packages/channel-edge`

ملفات جديدة:

| الملف | الغرض |
|---|---|
| `src/create-channel-edge.ts` | `createChannelEdge(options)` — بناء إضافات الحد (fail-closed · بلا مصغي) |
| `src/types.ts` | عقود `EdgeSurface` · `EdgeActorType` · `ChannelEdgeAdditions` (عقود مسماة لا دارجة) |
| `src/index.ts` | تصدير فقط (لا منطق تشغيلي) |
| `src/__tests__/create-channel-edge.test.ts` | اختبارات وحدة (5/5) — العقد لا التنفيذ |
| `README.md` · `tsconfig.json` · `vitest.config.ts` · `package.json` | وثائق + بنية + اختبار |

المسارات المُسجَّلة عند التفعيل (بلا فتح حي):

- `POST /edge/session` — إصدار الجلسة من `initData` موقَّع بسر الروبوت الصاحب للسطح (ADR-069 §2.1)
- `POST /edge/session/logout` — سحب الجلسة (§2.5)
- التوجيه من قائمة السماح **فقط** (§2.6-6 r2 — لا استنتاج آلي من الفحص 24)
- حذف `x-wasla-*` و`authorization` و`x-customer-public-id` قبل التوجيه (§2.6-2)
- `obo` من `exchange` وحده (§2.6-1)

### 2 · `bots/customer-bot/src/edge.ts` و`bots/driver-bot/src/edge.ts`

تركيب `@wasla/channel-edge` في جذر التركيب (`buildBotApp`) — **معطَّل افتراضيًا** (fail-closed):
`WASLA_EDGE_ENABLED` غير مسجَّل في `env-registry` ولا يُقرأ من جسم الطلب، فلا مسار يُسجَّل حيًا.

### 3 · `apps/*/src/session/session-init.ts`

تهيئة الجلسة من `Telegram.WebApp.initData` في زمن التشغيل لا خلف خطاف E2E وحده (§1.2-2 · CLM-0524):
`main.tsx` يستدعي `initSessionFromTelegram()` — لا تخزين محليًّا (ADR-044 §4 · ADR-019 §2.5).

### 4 · `packages/app-edge-e2e`

سقالة بوابة الأدلة E-01..E-27 (2/2 سقالة · لا حالات حيّة بعدُ).
الأدلة الحيّة تتطلّب قائمة سماح `production_open=true` وهو قرار مالك مستقل (ADR-069 §2.6-9).

## ما **لم يُمسَّ**

- قوائم السماح `packages/channel-edge/allowlist/*.json` — **بلا أي تغيير** (كلها `production_open=false` عمدًا · CLM-0521)
- `WASLA_USER_ASSERTION_MODE` · Render · إعدادات سرّ · إعادات كتابة إنتاجية — كلها خارج هذه الدفعة
- مسارات identity (CLM-0519 مدموجة سابقًا) — لا تغيير

## القياسات

- `pnpm -r typecheck` — 73 حزمة أخضر (بما فيها الحزمة الجديدة والبوتان والتطبيقان)
- `packages/channel-edge` — 5/5 وحدات نجاح
- `packages/app-edge-e2e` — 2/2 سقالة نجاح
- `run-tests.sh --print-groups` — `packages/app-edge-e2e` تُسلسَل (بوابة · `packages/*-e2e`)
- `pnpm-lock.yaml` — تغيير واحد فقط: إضافة `packages/channel-edge` (لا تعديل في أي حزمة أخرى)
- `verify-governance.sh` — 27/28 نجاح · فحص 8 `partially declared` (CI يُسأل حيًّا على GitHub Actions)

## الحجز

- `WORK_CLAIMS.md` — سطر نشط واحد: `CLM-0524 · M3-09 · feat/clm-0524-channel-edge-part2 · Active`
- `TASK_LOG.md` — إدخال CLM-0524 (In Progress · Kind: state-correction لسجل الحجز فقط) + إدخال هذه الدفعة
- `LAUNCH_EXECUTION_BOARD.md` — سطر M3-09 محدَّث بالإضافة (لا محو)

## الأصل السيادي

[ADR-069](../../../15-decisions/ADR-069-human-authentication-edge-for-apps.md) · [EDGE_ALLOWLIST.md](../EDGE_ALLOWLIST.md) · [STATE_SYNC_RULE.md](../../../00-rules/STATE_SYNC_RULE.md)
