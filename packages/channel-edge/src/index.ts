/**
 * `index.ts` — التركيبُ العامُّ لحزمةِ `@wasla/channel-edge`.
 *
 * ملفٌّ **تصديرٍ فقط**: لا منطقَ تنفيذيَّ هنا. فالحدُّ وحدةٌ قابلةٌ للتركيبِ
 * (ADR-069 §3) لا وحدةَ تشغيلٍ — ولا يجوزُ أن يبدأَ ترتيبَ الاستيرادِ هذا
 * عمليةً ولا مُصغيًّا.
 */

export * from "./types.js";
export { createChannelEdge, EdgeSessionRejectedError } from "./create-channel-edge.js";
export type { EdgeUpstream } from "./create-channel-edge.js";
