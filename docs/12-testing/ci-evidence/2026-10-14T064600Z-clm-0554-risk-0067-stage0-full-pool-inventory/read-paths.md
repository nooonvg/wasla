# CLM-0554 — مساراتُ القراءةِ لكلِّ خدمةٍ على Render (من الكود عند main `79729e07`)

القاعدة: لا يُفترضُ وجودُ `/ready`. كلُّ سطرٍ مأخوذٌ من موضعِ تسجيلِ المسارِ في الكود، ومسارُ فحصِ الصحةِ في Render من `serviceDetails.healthCheckPath` (Render API، 2026-10-14T06:46Z).

## 1. الجدول

| الخدمة | المسارُ المفتوح | الموضع | المصادقة | يلمسُ قاعدةَ البيانات؟ | أثرٌ جانبي | Render healthCheckPath |
|---|---|---|---|---|---|---|
| audit | `GET /health` | `services/audit/src/http/app.ts:64` + `server.ts:66` | مفتوح (`OPEN`) | مجسُّ كلِّ مجمعٍ مسجَّل، مخزَّنٌ 1 ث | لا | `/health` |
| customers | `GET /health` | `server.ts:324` | مفتوح | مجسٌّ مخزَّن 1 ث | لا | (فارغ) |
| delivery | `GET /health` · `GET /delivery/health` | `app.ts:931,936` + `server.ts:273` | مفتوح | مجسٌّ مخزَّن 1 ث | لا | (فارغ) |
| delivery | `GET /delivery/ready` | `app.ts:946` · `infrastructure/readiness-probe.ts:63-64` | مفتوح | **نعم، كلَّ طلب** (`SET LOCAL statement_timeout; SELECT 1 FROM store_orders LIMIT 1`) على مجمعِ delivery — بلا تخزين | لا كتابة (`SET LOCAL` ينقضي بانتهاءِ المعاملةِ الضمنية) | — |
| dispatch | `GET /health` | `app.ts:118` + `server.ts:178` | مفتوح | مجسٌّ مخزَّن 1 ث | لا | (فارغ) |
| drivers | `GET /health` | `server.ts:134` | مفتوح | مجسٌّ مخزَّن 1 ث | لا | (فارغ) |
| geography | `GET /health` | `app.ts:192` + `server.ts:127` | مفتوح | مجسٌّ مخزَّن 1 ث | لا | (فارغ) |
| identity | `GET /health` | `app.ts:162` + `server.ts:147` | مفتوح | مجسٌّ مخزَّن 1 ث | لا | (فارغ) |
| marketplace | `GET /health` | `app.ts:378` + `server.ts:109/152` | مفتوح | مجسٌّ مخزَّن 1 ث | لا | (فارغ) |
| matching | `GET /health` | `app.ts:124` + `server.ts:149` | مفتوح | مجسٌّ مخزَّن 1 ث | لا | (فارغ) |
| negotiations | `GET /health` | `app.ts:212` + `server.ts:134` | مفتوح | مجسٌّ مخزَّن 1 ث | لا | (فارغ) |
| orders | `GET /health` | `server.ts:149` | مفتوح | مجسٌّ مخزَّن 1 ث | لا | (فارغ) |
| reputation | `GET /health` | `app.ts:267` + `server.ts:109` | مفتوح | مجسٌّ مخزَّن 1 ث | لا | (فارغ) |
| search | `GET /health` · `GET /search/health` | `app.ts:256` + `server.ts:87` | مفتوح | مجسٌّ مخزَّن 1 ث | لا | (فارغ) |
| search | `GET /search/ready` | `service-identity.ts:15` | **رمزُ خدمة** | نعم | **كتابةُ صفِّ إعادة** (انظر §2) | — |
| subscriptions | `GET /health` | `app.ts:273` + `server.ts:73/119` | مفتوح | مجسٌّ مخزَّن 1 ث | لا | (فارغ) |
| customer-bot · driver-bot · partner-bot | `GET /health` | `packages/bot-runtime/src/http/app.ts:304` + `server.ts:111` | مفتوح | مجسٌّ مخزَّن 1 ث لكلِّ مجمعٍ مسجَّل | لا | (فارغ) |
| observability | `GET /healthz` | Render config | مفتوح | لا مجمع | لا | `/healthz` |
| otel-collector · alertmanager · prometheus | (لم يُجرَد مسارٌ في الكود — صورٌ جاهزة) | — | — | لا مجمع | — | (فارغ) |

«مجسٌّ مخزَّن 1 ث»: `attachDatabaseHealth` يستدعي `guard.probe()` لكلِّ مجمعٍ مسجَّلٍ في `REGISTRY` (`packages/resilience/src/pg-guard.ts:532-553`)، والنتيجةُ مخزَّنةٌ `probeCacheMs = 1000` (`pg-guard.ts:45,452`) ⇒ حِملُ `/health` لا يولّدُ أكثرَ من مجسٍّ واحدٍ في الثانيةِ لكلِّ مجمع، **فهو لا يختبرُ سعةَ المجمعاتِ** — يختبرُ وصولَ HTTP فقط. وتسجيلُ مجمعِ `service-auth-replay` في `REGISTRY` لا يحدثُ إلّا بعدَ أوّلِ طلبٍ مصادَق.

## 2. لماذا لا يوجدُ مسارُ قراءةٍ مصادَقٌ بلا أثرٍ جانبي

كلُّ طلبٍ يحملُ رمزَ خدمةٍ يمرُّ بـ`PostgresServiceTokenReplayGuard.remember` الذي ينفّذ `INSERT INTO <replay table> (kid, jti, retain_until) … ON CONFLICT (kid, jti) DO UPDATE` (`packages/service-auth/src/replay-postgres.ts:161-173`)، وفتحُ المخزنِ أوّلَ مرّةٍ ينفّذ `ensureServiceTokenReplaySchema` (`replay-store.ts:143-153`). أي أنّ **أيَّ حِملٍ على مسارٍ مصادَقٍ = كتابةٌ على الإنتاج**، وهي ممنوعةٌ في المرحلة 0، وتحتاجُ قرارًا صريحًا في خطةِ المرحلة 2.

## 3. الاستنتاجُ للخطة

- المسارُ الوحيدُ المفتوحُ الذي يمارسُ مجمعًا في كلِّ طلبٍ بلا كتابة: `GET /delivery/ready` (مجمعُ delivery وحدَه، `max=2`).
- لا مسارَ مفتوحًا يمارسُ مجمعَ `service-auth-replay` (`max=4`) ولا مجمعاتِ البوتات في كلِّ طلب.
- ⇒ حِملٌ «آمنٌ وممثِّلٌ للسقفِ المقيس (104)» **غيرُ ممكنِ التكوينِ اليومَ** بمساراتِ قراءةٍ بلا أثرٍ جانبي. وفقَ تعليماتِ المالك: الحكمُ لهدفِ الإنتاجِ = **HOLD** حتى يُعالَجَ النقص.
