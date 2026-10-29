import { useTranslation } from "react-i18next";
import { storeShareText, whatsappShareUrl } from "../share/whatsapp";

interface WhatsAppShareButtonProps {
  storeName: string;
  testId?: string;
}

/**
 * زر مشاركة المتجر عبر واتساب (D-XR-27 · المراجعة 6): رابط `wa.me` يفتح محادثة
 * بنص جاهز في تطبيق واتساب أو واتساب ويب، بلا أي اعتماد على منصة — مجرد رابط.
 */
export function WhatsAppShareButton({
  storeName,
  testId = "whatsapp-share-store",
}: WhatsAppShareButtonProps) {
  const { t } = useTranslation();
  return (
    <a
      href={whatsappShareUrl(storeShareText(storeName, t("appName")))}
      target="_blank"
      rel="noopener noreferrer"
      className="share-link"
      data-testid={testId}
    >
      {t("share.whatsapp_store")}
    </a>
  );
}
