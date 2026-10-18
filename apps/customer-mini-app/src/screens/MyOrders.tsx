import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "../api/client";
import { useSessionStore } from "../store/session";

interface OrderRequest {
  order_request_id: string;
  order_type: string;
  status: string;
  vehicle_class: string;
  price_mode: string;
  created_at: string;
}

/** CMS §3.6 L86: the screen lists the customer's last five requests. */
export const LAST_ORDERS_LIMIT = 5;

export function MyOrders() {
  const { t } = useTranslation();
  const { token, customerId } = useSessionStore();
  const [orders, setOrders] = useState<OrderRequest[]>([]);
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  const loadOrders = useCallback(async (filterStatus?: string) => {
    if (!token || !customerId) return;
    setLoading(true);
    setError(null);
    try {
      // G-S9.10 (CLM-0616): CMS §3.6 L86 «آخر 5 طلبات» · L90
      // `GET /customers/{id}/order-requests?limit=5`. `limit` is the only query
      // parameter of `listOrderRequests`; the status filter is kept as it was
      // (sent alongside, unchanged) — the service does not declare or read it,
      // a separate measured finding (G-S9.15), not resolved in this slice.
      const params = new URLSearchParams();
      if (filterStatus) params.set("status", filterStatus);
      params.set("limit", String(LAST_ORDERS_LIMIT));
      const result = await apiClient.get<{ items: OrderRequest[] }>(
        `/customers/${customerId}/order-requests?${params.toString()}`
      );
      setOrders(result.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load_failed");
    } finally {
      setLoading(false);
    }
  }, [token, customerId]);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    loadOrders();
  }, [loadOrders]);

  const handleFilterChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newStatus = e.target.value;
    setStatus(newStatus);
    loadOrders(newStatus || undefined);
  }, [loadOrders]);

  if (loading && orders.length === 0) {
    return (
      <div className="screen my-orders-screen">
        <h1>{t("orders.title")}</h1>
        <div className="loading-indicator" data-testid="orders-loading">
          {t("common.loading")}
        </div>
      </div>
    );
  }

  if (error && orders.length === 0) {
    return (
      <div className="screen my-orders-screen">
        <h1>{t("orders.title")}</h1>
        <div className="error-message" role="alert" data-testid="orders-error">
          {t(`errors.${error}`)}
        </div>
      </div>
    );
  }

  return (
    <div className="screen my-orders-screen">
      <h1>{t("orders.title")}</h1>

      <div className="form-group">
        <label htmlFor="status-filter">{t("orders.filter_status")}</label>
        <select
          id="status-filter"
          value={status}
          onChange={handleFilterChange}
          data-testid="status-filter-select"
        >
          <option value="">{t("orders.filter_all")}</option>
          <option value="submitted">{t("orders.status_submitted")}</option>
          <option value="accepted">{t("orders.status_accepted")}</option>
          <option value="completed">{t("orders.status_completed")}</option>
          <option value="cancelled">{t("orders.status_cancelled")}</option>
        </select>
      </div>

      {loading && orders.length > 0 && (
        <div className="loading-indicator" data-testid="orders-reloading">
          {t("common.loading")}
        </div>
      )}

      {!loading && orders.length === 0 && (
        <div className="empty-state" data-testid="orders-empty">
          {t("orders.empty")}
        </div>
      )}

      {orders.length > 0 && (
        <ul className="orders-list" data-testid="orders-list">
          {orders.map((order) => (
            <li key={order.order_request_id} className="order-item" data-testid={`order-${order.order_request_id}`}>
              <span className="order-id">{order.order_request_id}</span>
              <span className="order-type">{t(`orders.type_${order.order_type}`)}</span>
              <span className="order-status">{t(`orders.status_${order.status}`)}</span>
              <span className="order-vehicle">{t(`ride_order.vehicle_${order.vehicle_class}`)}</span>
              <span className="order-date">{new Date(order.created_at).toLocaleDateString("ar-SA")}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
