import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "../api/client";
import { useSessionStore } from "../store/session";
import { StoreSearch } from "../components/StoreSearch";
import { formatMoney, localizedTitle, type LocalizedTitle } from "../i18n/format";
import { WhatsAppShareButton } from "../components/WhatsAppShareButton"; // D-XR-27 (المراجعة 6): مشاركة المتجر عبر واتساب.

/** services/marketplace `StoreResource` field names (toStoreResource). */
interface Store extends LocalizedTitle {
  store_id: string;
  store_slug: string;
  description_ar?: string;
  category_id?: string;
}

/** services/marketplace `ProductResource` field names (toProductResource). */
interface Product extends LocalizedTitle {
  product_id: string;
  store_slug: string;
  description_ar?: string;
  price_minor_units: number;
  currency_code: string;
}

export function Marketplace() {
  const { t, i18n } = useTranslation();
  const { token } = useSessionStore();
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStore, setSelectedStore] = useState<string | null>(null);
  const [selectedStoreName, setSelectedStoreName] = useState<string>("");
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  const loadStores = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiClient.get<{ items: Store[]; limit: number }>("/stores");
      setStores(result.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load_failed");
    } finally {
      setLoading(false);
    }
  }, [token]);

  const loadProducts = useCallback(async (slug: string) => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiClient.get<{ items: Product[]; limit: number }>(`/stores/${slug}/products`);
      setProducts(result.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load_failed");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    loadStores();
  }, [loadStores]);

  const handleStoreClick = useCallback((slug: string, displayName?: string) => {
    setSelectedStore(slug);
    setSelectedStoreName(displayName ?? "");
    setProducts([]);
    loadProducts(slug);
  }, [loadProducts]);

  const handleBack = useCallback(() => {
    setSelectedStore(null);
    setSelectedStoreName("");
    setProducts([]);
  }, []);

  if (loading && stores.length === 0 && !selectedStore) {
    return (
      <div className="screen marketplace-screen">
        <h1>{t("marketplace.title")}</h1>
        <div className="loading-indicator" data-testid="marketplace-loading">
          {t("common.loading")}
        </div>
      </div>
    );
  }

  if (error && stores.length === 0) {
    return (
      <div className="screen marketplace-screen">
        <h1>{t("marketplace.title")}</h1>
        <div className="error-message" role="alert" data-testid="marketplace-error">
          {t(`errors.${error}`)}
        </div>
        <button type="button" onClick={loadStores} data-testid="marketplace-retry">
          {t("common.retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="screen marketplace-screen">
      <h1>{t("marketplace.title")}</h1>

      {selectedStore ? (
        <div data-testid="store-products-view">
          <button type="button" className="back-button" onClick={handleBack} data-testid="back-to-stores">
            {t("marketplace.back_to_stores")}
          </button>
          <h2 data-testid="selected-store-name">{selectedStoreName || selectedStore}</h2>

          {/* D-XR-27 (المراجعة 6): مشاركة المتجر عبر واتساب برابط wa.me، بلا اعتماد منصة. */}
          {selectedStoreName && (
            <WhatsAppShareButton storeName={selectedStoreName} />
          )}

          {loading && (
            <div className="loading-indicator" data-testid="products-loading">
              {t("common.loading")}
            </div>
          )}

          {error && (
            <div className="error-message" role="alert" data-testid="products-error">
              {t(`errors.${error}`)}
            </div>
          )}

          {!loading && !error && products.length === 0 && (
            <div className="empty-state" data-testid="products-empty">
              {t("marketplace.no_products")}
            </div>
          )}

          {!loading && products.length > 0 && (
            <ul className="products-list" data-testid="products-list">
              {products.map((product) => (
                <li key={product.product_id} className="product-item" data-testid={`product-${product.product_id}`}>
                  <span className="product-name">{localizedTitle(product, i18n.language)}</span>
                  <span className="product-price">
                    <bdi>{formatMoney({ amount_minor: product.price_minor_units, currency: product.currency_code }, i18n.language)}</bdi>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          {/* G-S9.7 (CLM-0649): name search over the search service's derived model. */}
          <StoreSearch testId="store-search" onSelect={(store) => handleStoreClick(store.store_slug, store.title)} />

          {stores.length === 0 && !loading && (
            <div className="empty-state" data-testid="stores-empty">
              {t("marketplace.no_stores")}
            </div>
          )}

          {stores.length > 0 && (
            <ul className="stores-list" data-testid="stores-list">
              {stores.map((store) => (
                <li
                  key={store.store_id}
                  className="store-item"
                  data-testid={`store-${store.store_slug}`}
                  onClick={() => handleStoreClick(store.store_slug, localizedTitle(store, i18n.language))}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") handleStoreClick(store.store_slug, localizedTitle(store, i18n.language));
                  }}
                >
                  <span className="store-name">{localizedTitle(store, i18n.language)}</span>
                  {store.description_ar && (
                    <span className="store-description">{store.description_ar}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
