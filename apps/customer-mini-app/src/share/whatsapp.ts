/**
 * `share/whatsapp.ts` — المشاركة عبر واتساب (تعليمة المالك الرابعة · المراجعة 6 · D-XR-27).
 *
 * روابط `wa.me` رسمية من واتساب تفتح محادثة بنص جاهز، وتعمل على الجوال والحاسوب
 * وعلى الويب، ولا تحتاج حسابًا تجاريًا ولا API ولا اعتمادًا خارجيًا — لذا تُبنى
 * فورًا داخل كل القنوات. أما بوت واتساب والإشعارات المرسلة منه فقناة WhatsApp
 * Business Platform (Cloud API) وتحتاج قرار المالك OD-XR-11 (حساب WABA ورقم
 * مخصص وتوثيق Meta)، ولا يُبنى منها شيء قبل قراره.
 */

/** يبني رابط مشاركة wa.me بنص مرمَّز. يرفض النص الفارغ. */
export function whatsappShareUrl(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("share_text_empty");
  }
  return `https://wa.me/?text=${encodeURIComponent(trimmed)}`;
}

/** نص مشاركة المتجر: اسم المتجر + اسم التطبيق. يرفض الاسم الفارغ. */
export function storeShareText(storeName: string, appName: string): string {
  const name = storeName.trim();
  if (!name) {
    throw new Error("store_name_empty");
  }
  return `اطلب من «${name}» عبر ${appName}`;
}
