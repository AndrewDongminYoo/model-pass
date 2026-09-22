import { useState } from "react";
import {
  manageApplicantPrivacy,
  type ApplicantCapability,
  type ApplicantPrivacyCommand,
} from "../api/applicant-privacy";
import { useI18n } from "../../../i18n/locale";

interface ApplicantPrivacyControlsProps {
  capability: ApplicantCapability;
}

type PrivacyAction = ApplicantPrivacyCommand["action"];

export function ApplicantPrivacyControls({
  capability,
}: ApplicantPrivacyControlsProps) {
  const { t } = useI18n();
  const [pendingAction, setPendingAction] = useState<PrivacyAction | null>(
    null,
  );
  const [completedAction, setCompletedAction] = useState<PrivacyAction | null>(
    null,
  );
  const [failedAction, setFailedAction] = useState<PrivacyAction | null>(null);

  async function submit(action: PrivacyAction) {
    setPendingAction(action);
    setCompletedAction(null);
    setFailedAction(null);
    try {
      const result = await manageApplicantPrivacy({ ...capability, action });
      setCompletedAction(result.action);
    } catch {
      setFailedAction(action);
    } finally {
      setPendingAction(null);
    }
  }

  const isPending = pendingAction !== null;

  return (
    <section
      className="detail-section"
      aria-label={t("Privacy controls", "개인정보 관리")}
    >
      <h3>{t("Privacy controls", "개인정보 관리")}</h3>
      <p>
        {t(
          "A deletion request is subject to retention obligations and does not immediately erase records.",
          "삭제 요청을 보내도 법정 보관 의무가 있는 기록은 즉시 삭제되지 않을 수 있습니다.",
        )}
      </p>
      <div className="button-row">
        <button
          className="button--secondary"
          type="button"
          disabled={isPending}
          onClick={() => void submit("revoke_future_opportunity_consent")}
        >
          {t("Revoke future-opportunity consent", "향후 모집 알림 동의 철회")}
        </button>
        <button
          className="button--danger"
          type="button"
          disabled={isPending}
          onClick={() => void submit("request_deletion")}
        >
          {t("Request deletion", "개인정보 삭제 요청")}
        </button>
      </div>
      {isPending ? (
        <p role="status">
          {t("Submitting privacy request…", "요청을 보내고 있습니다…")}
        </p>
      ) : null}
      {completedAction ? (
        <p className="status--success" role="status">
          {successMessage(completedAction, t)}
        </p>
      ) : null}
      {failedAction ? (
        <div role="alert">
          <p>
            {t(
              "Could not submit your privacy request. You can retry safely.",
              "요청을 보내지 못했습니다. 다시 시도해 주세요.",
            )}
          </p>
          <button
            className="button--secondary"
            type="button"
            onClick={() => void submit(failedAction)}
          >
            {t("Retry privacy request", "다시 시도")}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function successMessage(
  action: PrivacyAction,
  t: (en: string, ko: string) => string,
): string {
  if (action === "revoke_future_opportunity_consent") {
    return t(
      "Future-opportunity consent has been revoked.",
      "향후 모집 알림 동의를 철회했습니다.",
    );
  }
  return t(
    "Your deletion request is pending. Records are not immediately erased.",
    "삭제 요청을 접수했습니다. 기록은 즉시 삭제되지 않을 수 있습니다.",
  );
}
