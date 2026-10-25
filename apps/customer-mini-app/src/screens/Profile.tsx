import { useState, useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "../api/client";
import { useSessionStore } from "../store/session";
import { logoutSession } from "../session/session-init";
import { accountDeletionAvailable, requestAccountDeletion } from "../host/account-deletion";

interface Profile {
  display_name?: string | null;
  phone_number?: string | null;
  email?: string | null;
  preferred_language?: string | null;
}

export function Profile() {
  const { t } = useTranslation();
  const { token, customerId } = useSessionStore();
  const [profile, setProfile] = useState<Profile>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [confirmingDeletion, setConfirmingDeletion] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletionError, setDeletionError] = useState<string | null>(null);
  const [deletionAvailable, setDeletionAvailable] = useState(false);
  const loadedRef = useRef(false);

  useEffect(() => {
    // D-XR-13: الإتاحةُ تُقرأُ مرةً عندَ العرضِ — إثباتُ الويبِ في الذاكرةِ لا يتغيّرُ إلا بدخولٍ جديدٍ (إعادةُ تحميلٍ).
    setDeletionAvailable(accountDeletionAvailable());
  }, []);

  const loadProfile = useCallback(async () => {
    if (!token || !customerId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await apiClient.get<Profile>(`/customers/${customerId}/profile`);
      setProfile(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load_failed");
    } finally {
      setLoading(false);
    }
  }, [token, customerId]);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    loadProfile();
  }, [loadProfile]);

  const handleSave = useCallback(async () => {
    if (!token || !customerId) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      await apiClient.put(`/customers/${customerId}/profile`, profile);
      setSuccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save_failed");
    } finally {
      setSaving(false);
    }
  }, [token, customerId, profile]);

  const handleFieldChange = useCallback((field: keyof Profile, value: string) => {
    setProfile((prev) => ({ ...prev, [field]: value || null }));
    setSuccess(false);
  }, []);

  /**
   * D-XR-13 (CLM-0699): الحذفُ فعلُ الشخصِ عندَ النواةِ بجلستهِ هو — النجاحُ (204)
   * يبدأُ الوداعَ: العلامةُ في المخزنِ أولًا (لا تومضُ شاشةُ دخولٍ)، ثمّ مسحُ
   * جلسةِ السوقِ عبرَ الحدِّ (وفشلُ الطلبِ لا يُحيي الجلسةَ المحليّةَ — `logoutSession`
   * يمسحُ محليًّا في كلِّ حالٍ ويمنعُ إعادةَ التهيئةِ التلقائيّةَ).
   */
  const handleDeleteAccount = useCallback(async () => {
    setDeleting(true);
    setDeletionError(null);
    let outcome: Awaited<ReturnType<typeof requestAccountDeletion>>;
    try {
      outcome = await requestAccountDeletion();
    } finally {
      setDeleting(false);
    }
    if (outcome.status === "deleted") {
      useSessionStore.getState().markAccountDeleted();
      await logoutSession();
      return;
    }
    if (outcome.status === "refused_admin") {
      setDeletionError(
        outcome.organizationIds.length > 0
          ? t("deletion.refused_admin", { ids: outcome.organizationIds.join(" · ") })
          : t("deletion.refused_admin_no_ids"),
      );
      return;
    }
    if (outcome.status === "unauthenticated") {
      setDeletionError(t("deletion.unauthenticated"));
      return;
    }
    if (outcome.status === "no_web_credential") {
      setDeletionError(t("deletion.web_only"));
      return;
    }
    setDeletionError(t("deletion.failed"));
  }, [t]);

  if (loading) {
    return (
      <div className="screen profile-screen">
        <h1>{t("profile.title")}</h1>
        <div className="loading-indicator" data-testid="profile-loading">
          {t("common.loading")}
        </div>
      </div>
    );
  }

  return (
    <div className="screen profile-screen">
      <h1>{t("profile.title")}</h1>

      {error && (
        <div className="error-message" role="alert" data-testid="profile-error">
          {t(`errors.${error}`)}
        </div>
      )}

      {success && (
        <div className="success-message" data-testid="profile-saved">
          {t("profile.saved")}
        </div>
      )}

      <div className="form-group">
        <label htmlFor="display-name">{t("profile.display_name")}</label>
        <input
          id="display-name"
          type="text"
          value={profile.display_name || ""}
          onChange={(e) => handleFieldChange("display_name", e.target.value)}
          placeholder={t("profile.display_name_placeholder")}
          data-testid="display-name-input"
        />
      </div>

      <div className="form-group">
        <label htmlFor="phone-number">{t("profile.phone_number")}</label>
        <input
          id="phone-number"
          type="tel"
          value={profile.phone_number || ""}
          onChange={(e) => handleFieldChange("phone_number", e.target.value)}
          placeholder="+966..."
          data-testid="phone-number-input"
        />
      </div>

      <div className="form-group">
        <label htmlFor="email">{t("profile.email")}</label>
        <input
          id="email"
          type="email"
          value={profile.email || ""}
          onChange={(e) => handleFieldChange("email", e.target.value)}
          placeholder="email@example.com"
          data-testid="email-input"
        />
      </div>

      <div className="form-group">
        <label htmlFor="preferred-language">{t("profile.preferred_language")}</label>
        <select
          id="preferred-language"
          value={profile.preferred_language || ""}
          onChange={(e) => handleFieldChange("preferred_language", e.target.value)}
          data-testid="preferred-language-select"
        >
          <option value="">{t("profile.language_none")}</option>
          <option value="ar">العربية</option>
          <option value="en">English</option>
          <option value="ur">اردو</option>
        </select>
      </div>

      <button
        type="button"
        onClick={handleSave}
        disabled={saving || !token || !customerId}
        data-testid="save-profile-button"
      >
        {saving ? t("common.loading") : t("profile.save_button")}
      </button>

      {/* ADR-072 D1 · CMS §3.8: saved places (list · add · delete) are managed
          from Profile. The places screen keeps its own route; Profile is its
          entry point now that Home no longer links to it. */}
      <section className="profile-places" aria-labelledby="profile-places-heading">
        <h2 id="profile-places-heading">{t("places.title")}</h2>
        <a href="#/places" data-testid="profile-places-link">
          <span aria-hidden="true">📍</span>
          <span>{t("places.title")}</span>
        </a>
      </section>

      {/* D-XR-13 (CLM-0699): حذفُ الحسابِ — فعلٌ نهائيٌّ يُطلَبُ من النواةِ بجلسةِ
          الشخصِ؛ تأكيدٌ صريحٌ لا زرٌّ عابرٌ، وحدٌّ معلَنٌ لمستعملِ المصغّرِ. */}
      <section className="profile-deletion" aria-labelledby="profile-deletion-heading">
        <h2 id="profile-deletion-heading">{t("deletion.title")}</h2>
        {deletionAvailable ? (
          <>
            <p data-testid="deletion-warning">{t("deletion.warning")}</p>
            {confirmingDeletion ? (
              <>
                <p role="alert" data-testid="deletion-confirm-text">
                  {t("deletion.confirm_text")}
                </p>
                <button
                  type="button"
                  data-testid="delete-account-confirm"
                  onClick={() => void handleDeleteAccount()}
                  disabled={deleting}
                >
                  {deleting ? t("common.submitting") : t("deletion.confirm_button")}
                </button>
                <button
                  type="button"
                  data-testid="delete-account-cancel"
                  onClick={() => setConfirmingDeletion(false)}
                  disabled={deleting}
                >
                  {t("common.cancel")}
                </button>
              </>
            ) : (
              <button
                type="button"
                data-testid="delete-account-button"
                onClick={() => setConfirmingDeletion(true)}
              >
                {t("deletion.button")}
              </button>
            )}
            {deletionError && (
              <div className="error-message" role="alert" data-testid="deletion-error">
                {deletionError}
              </div>
            )}
          </>
        ) : (
          <p data-testid="deletion-web-only">{t("deletion.web_only")}</p>
        )}
      </section>
    </div>
  );
}
