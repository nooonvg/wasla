#!/usr/bin/env bash
# xr-frozen-paths.sh — المصدرُ الواحدُ لما جمّدَه ADR-076 (XR-1 في docs/ecosystem/ECOSYSTEM_ROADMAP.md).
# يُستدعى بـsource من validate-xr-domain-freeze.sh. أيُّ تعديلٍ هنا تعديلٌ لقرار: يلزمُه ADR.
# shellcheck disable=SC2034

# XR-1.1 — مجالُ MOVE (التنفيذُ الميدانيّ) · ملكُ nooonvg/ceezr
# XR-1.2 — مجالاتُ CORE المكرّرةُ تكرارًا كاملًا · ملكُ nooonvg/wasla-core
XR_FROZEN_PREFIXES=(
  "services/dispatch/"
  "services/drivers/"
  "services/matching/"
  "services/negotiations/"
  "services/orders/"
  "services/rides/"
  "apps/driver-mini-app/"
  "bots/driver-bot/"
  "services/identity/"
  "services/subscriptions/"
  "services/billing/"
  "services/reputation/"
)

# XR-1.3 — ساقُ التوصيلِ في services/delivery (ADR-026 §2.4): delivery_task → dispatch.
# طلبُ المتجرِ store_order في الخدمةِ نفسِها يبقى مفتوحًا.
XR_FROZEN_FILES=(
  "services/delivery/src/domain/dispatch-mirror.ts"
  "services/delivery/src/infrastructure/dispatch-event-source.ts"
  "services/delivery/src/infrastructure/task-mirror-store.ts"
  "services/delivery/src/use-cases/delegate-to-dispatch.ts"
)
