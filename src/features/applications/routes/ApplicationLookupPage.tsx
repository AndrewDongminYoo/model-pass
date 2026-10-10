import { useState, type FormEvent } from "react";
import { AttendanceManager } from "../../attendance/components/AttendanceManager";
import { ApplicantPrivacyControls } from "../../privacy/components/ApplicantPrivacyControls";
import { appNameFor } from "../../../i18n/brand";
import { useI18n } from "../../../i18n/locale";
import { resolveApplication } from "../api/resolve-application";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LookupError = "invalid" | "not_found" | "unavailable";

interface ResolvedCapability {
  applicationId: string;
  opportunityId: string;
  submissionAttemptId: string;
}

// Lets an applicant reach attendance and privacy controls with the receipt
// number and private management code, even after the opportunity closes.
// The attendance reminder lands here.
export function ApplicationLookupPage() {
  const { locale, t } = useI18n();
  const [applicationId, setApplicationId] = useState("");
  const [submissionAttemptId, setSubmissionAttemptId] = useState("");
  const [error, setError] = useState<LookupError>();
  const [pending, setPending] = useState(false);
  const [capability, setCapability] = useState<ResolvedCapability>();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) {
      return;
    }
    const receipt = {
      applicationId: applicationId.trim(),
      submissionAttemptId: submissionAttemptId.trim(),
    };
    if (
      !uuidPattern.test(receipt.applicationId) ||
      !uuidPattern.test(receipt.submissionAttemptId)
    ) {
      setError("invalid");
      return;
    }

    setPending(true);
    setError(undefined);
    try {
      const result = await resolveApplication(receipt);
      if (result.status === "not_found") {
        setError("not_found");
        return;
      }
      setCapability({ ...receipt, opportunityId: result.opportunityId });
    } catch {
      setError("unavailable");
    } finally {
      setPending(false);
    }
  }

  if (capability !== undefined) {
    return (
      <main className="app-shell app-shell--narrow">
        <section
          className="surface"
          aria-labelledby="application-lookup-result-heading"
        >
          <h1 id="application-lookup-result-heading">
            {t("Your application", "지원 내역")}
          </h1>
          <p className="code-value">
            {t("Application ID", "접수 번호")}: {capability.applicationId}
          </p>
          <AttendanceManager capability={capability} viewerParty="applicant" />
          <ApplicantPrivacyControls capability={capability} />
        </section>
      </main>
    );
  }

  const errorMessage =
    error === "invalid"
      ? t(
          "Enter a valid application ID and private management code.",
          "올바른 접수 번호와 비공개 관리 코드를 입력해 주세요.",
        )
      : error === "not_found"
        ? t(
            "No application matches. Check your application ID and private management code.",
            "일치하는 지원 내역이 없습니다. 접수 번호와 비공개 관리 코드를 다시 확인해 주세요.",
          )
        : error === "unavailable"
          ? t(
              "We couldn't check your application. Try again in a moment.",
              "지원 내역을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
            )
          : undefined;

  return (
    <main className="app-shell app-shell--narrow">
      <header className="page-header">
        <p className="eyebrow">{appNameFor(locale)}</p>
        <h1>{t("Check my application", "내 지원 확인")}</h1>
        <p className="lede">
          {t(
            "Enter the application ID and private management code you received after applying to confirm attendance or manage your information.",
            "지원 후 받은 접수 번호와 비공개 관리 코드를 입력하면 참여를 확정하거나 내 정보를 관리할 수 있습니다.",
          )}
        </p>
      </header>
      <form className="surface form-stack" noValidate onSubmit={handleSubmit}>
        <label htmlFor="lookup-application-id">
          {t("Application ID", "접수 번호")}
        </label>
        <input
          id="lookup-application-id"
          value={applicationId}
          autoComplete="off"
          aria-describedby={errorMessage ? "lookup-error" : undefined}
          aria-invalid={errorMessage ? true : undefined}
          onChange={(event) => {
            setApplicationId(event.target.value);
            setError(undefined);
          }}
        />
        <label htmlFor="lookup-private-management-code">
          {t("Private management code", "비공개 관리 코드")}
        </label>
        <input
          id="lookup-private-management-code"
          type="password"
          value={submissionAttemptId}
          autoComplete="off"
          aria-describedby={errorMessage ? "lookup-error" : undefined}
          aria-invalid={errorMessage ? true : undefined}
          onChange={(event) => {
            setSubmissionAttemptId(event.target.value);
            setError(undefined);
          }}
        />
        {errorMessage ? (
          <p id="lookup-error" role="alert">
            {errorMessage}
          </p>
        ) : null}
        <button type="submit" disabled={pending}>
          {pending
            ? t("Checking…", "확인하고 있습니다…")
            : t("Find my application", "지원 내역 확인")}
        </button>
      </form>
    </main>
  );
}
