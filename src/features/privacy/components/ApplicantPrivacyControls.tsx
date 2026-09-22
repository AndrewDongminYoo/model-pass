import { useState } from "react";
import {
  manageApplicantPrivacy,
  type ApplicantCapability,
  type ApplicantPrivacyCommand,
  type ApplicantPrivacyResult,
} from "../api/applicant-privacy";

interface ApplicantPrivacyControlsProps {
  capability: ApplicantCapability;
}

type PrivacyAction = ApplicantPrivacyCommand["action"];

export function ApplicantPrivacyControls({
  capability,
}: ApplicantPrivacyControlsProps) {
  const [pendingAction, setPendingAction] = useState<PrivacyAction | null>(
    null,
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [failedAction, setFailedAction] = useState<PrivacyAction | null>(null);

  async function submit(action: PrivacyAction) {
    setPendingAction(action);
    setStatusMessage(null);
    setFailedAction(null);
    try {
      const result = await manageApplicantPrivacy({ ...capability, action });
      setStatusMessage(successMessage(result));
    } catch {
      setFailedAction(action);
    } finally {
      setPendingAction(null);
    }
  }

  const isPending = pendingAction !== null;

  return (
    <section aria-label="Privacy controls">
      <h3>Privacy controls</h3>
      <p>
        A deletion request is subject to retention obligations and does not
        immediately erase records.
      </p>
      <button
        type="button"
        disabled={isPending}
        onClick={() => void submit("revoke_future_opportunity_consent")}
      >
        Revoke future-opportunity consent
      </button>
      <button
        type="button"
        disabled={isPending}
        onClick={() => void submit("request_deletion")}
      >
        Request deletion
      </button>
      {isPending ? <p role="status">Submitting privacy request.</p> : null}
      {statusMessage ? <p role="status">{statusMessage}</p> : null}
      {failedAction ? (
        <div role="alert">
          <p>Could not submit your privacy request. You can retry safely.</p>
          <button type="button" onClick={() => void submit(failedAction)}>
            Retry privacy request
          </button>
        </div>
      ) : null}
    </section>
  );
}

function successMessage(result: ApplicantPrivacyResult): string {
  if (result.action === "revoke_future_opportunity_consent") {
    return "Future-opportunity consent has been revoked.";
  }
  return "Your deletion request is pending. Records are not immediately erased.";
}
