import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  whatsappShareUrl,
  storeShareText,
} from "../share/whatsapp";
import { WhatsAppShareButton } from "../components/WhatsAppShareButton";
import "../i18n";

// D-XR-27 (المراجعة 6): المشاركة عبر واتساب برابط wa.me — ترميز صحيح للنص
// العربي، ورفض النص الفارغ، وزر يفتح المحادثة بالنص الجاهز.

describe("whatsappShareUrl", () => {
  it("builds a wa.me link with encoded Arabic text", () => {
    const url = whatsappShareUrl("اطلب من «متجر جدة» عبر وَصْلة");
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    const encoded = url.slice("https://wa.me/?text=".length);
    expect(decodeURIComponent(encoded)).toBe("اطلب من «متجر جدة» عبر وَصْلة");
  });

  it("rejects empty and whitespace-only text", () => {
    expect(() => whatsappShareUrl("")).toThrow("share_text_empty");
    expect(() => whatsappShareUrl("   ")).toThrow("share_text_empty");
  });
});

describe("storeShareText", () => {
  it("includes the store name and app name", () => {
    const text = storeShareText("متجر جدة", "وَصْلة");
    expect(text).toContain("متجر جدة");
    expect(text).toContain("وَصْلة");
  });

  it("rejects an empty store name", () => {
    expect(() => storeShareText("  ", "وَصْلة")).toThrow("store_name_empty");
  });
});

describe("WhatsAppShareButton", () => {
  it("renders a wa.me anchor with the store share text and a label", () => {
    render(<WhatsAppShareButton storeName="متجر جدة" />);
    const link = screen.getByTestId("whatsapp-share-store");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toContain("https://wa.me/?text=");
    expect(link.getAttribute("href")).toContain(
      encodeURIComponent("متجر جدة"),
    );
    expect(link.textContent).toContain("واتساب");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });
});
