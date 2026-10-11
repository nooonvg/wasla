/**
 * `types.ts` — عقودُ `@wasla/channel-edge` المسمَّاةُ لا الدارجةُ.
 *
 * التركيبُ في `createBotApp` يحملُ هذه الحقولَ بقيمةٍ مسماةٍ من ترتيبِ التركيبِ
 * (بعدَ حارسِ الفحصِ 24 و28)، لا بحساباتٍ داخليةٍ. وهذا هو العقدُ الذي يمكِنُ
 * لِمراجعٍ أن يقرأَهُ بلا فتحِ الشفرةِ (ADR-027 §6-3 · STATE-SYNC).
 */

import type { FastifyInstance } from "fastify";
import type { ServiceRequestSigner } from "@wasla/service-auth";

/** الدورُ المسموحُ لكلِ سطحٍ تطبيقٍ (ADR-069 §2.1). */
export type EdgeActorType = "customer" | "driver";

/** عقدُ سطحِ واحدٍ من الأسطحِ الثلاثةِ (client · driver · admin). */
export interface EdgeSurface {
  /** الدورُ المُسمّى للسطحِ (ADR-069 §2.1: customer / driver). */
  readonly actorType: EdgeActorType;
  /** سرُّ الروبوتِ الذي فتحَ التطبيقَ المصغَّرَ (ADR-069 §2.3). */
  readonly botToken: string;
  /** مُوقِّعُ الرموزِ للنداءاتِ الخلفيةِ (نفسُ مُوقِّعِ الروبوتِ القائمِ). */
  readonly requestSigner: ServiceRequestSigner;
  /** `wasla_public_id` المُستعملُ في `obo` من جلسةِ المستخدمِ الموثَّقةِ وحدها. */
  readonly waslaPublicIdOf: (token: string) => Promise<string>;
}

/** العقدُ الكاملُ للحدِّ كما يركَّبُ في `createBotApp` (بعدَ الحرسِ 24 و28). */
export interface ChannelEdgeAdditions {
  /** مساراتُ الحدِّ الجديدةُ التي تُركَّبُ على التطبيقِ (كائن Fastify). */
  readonly apply: (app: FastifyInstance) => void;
}

/**
 * المفتاحُ الذي يحملُ الشفرةُ تركيبَ `@wasla/channel-edge` في `createBotApp`.
 * لا يُقرأُ من الجسمِ ولا من الترويساتِ — من ترتيبِ التركيبِ وحدهُ.
 */
export const CHANNEL_EDGE_ADDITIONS_KEY = Symbol.for(
  "wasla.channel-edge.additions",
) as symbol & {
  readonly brand: "wasla.channel-edge.additions";
};
