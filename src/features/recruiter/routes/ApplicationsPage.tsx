import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  RecruiterAuthenticationError,
  getRecruiterApplications,
  type RecruiterApplication,
} from "../../applications/api/application-photos";
import { ApplicationCard } from "../components/ApplicationCard";
import { appNameFor } from "../../../i18n/brand";
import { useI18n } from "../../../i18n/locale";
import { closeOpportunity } from "../../opportunities/api/close-opportunity";

export function ApplicationsPage() {
  const { locale, t } = useI18n();
  const { opportunityId } = useParams<{ opportunityId: string }>();
  const [result, setResult] = useState<{
    opportunityId: string;
    applications?: RecruiterApplication[];
    error?: "authentication" | "load";
  }>();
  const [closure, setClosure] = useState<{
    opportunityId: string;
    status: "confirming" | "pending" | "closed" | "error";
  }>();

  async function confirmClosure() {
    if (opportunityId === undefined || closure?.status === "pending") return;
    setClosure({ opportunityId, status: "pending" });
    try {
      await closeOpportunity(opportunityId);
      setClosure({ opportunityId, status: "closed" });
    } catch {
      setClosure({ opportunityId, status: "error" });
    }
  }

  useEffect(() => {
    let active = true;
    if (opportunityId === undefined) {
      return () => {
        active = false;
      };
    }

    void getRecruiterApplications(opportunityId)
      .then((loaded) => {
        if (active) {
          setResult({
            opportunityId,
            applications: [...loaded].sort(
              (left, right) =>
                left.createdAt.localeCompare(right.createdAt) ||
                left.id.localeCompare(right.id),
            ),
          });
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setResult({
            opportunityId,
            error:
              loadError instanceof RecruiterAuthenticationError
                ? "authentication"
                : "load",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [opportunityId]);

  const currentResult =
    result?.opportunityId === opportunityId ? result : undefined;
  const error =
    opportunityId === undefined
      ? t("This opportunity is unavailable.", "이 공고를 볼 수 없습니다.")
      : currentResult?.error === "authentication"
        ? t(
            "Sign in to review applications.",
            "지원 내역을 보려면 로그인해 주세요.",
          )
        : currentResult?.error === "load"
          ? t(
              "Could not load applications.",
              "지원 내역을 불러오지 못했습니다.",
            )
          : undefined;
  const applications = currentResult?.applications;
  const closureStatus =
    closure !== undefined && closure.opportunityId === opportunityId
      ? closure.status
      : undefined;

  return (
    <main className="app-shell">
      <header className="page-header">
        <p className="eyebrow">
          {appNameFor(locale)} · {t("Recruiter", "모집자")}
        </p>
        <h1>{t("Applications", "지원 내역")}</h1>
        <p className="lede">
          {t(
            "Review eligibility results and applications before choosing a model.",
            "지원자를 선택하기 전에 조건 확인 결과와 지원 내용을 살펴보세요.",
          )}
        </p>
      </header>
      {applications !== undefined && opportunityId !== undefined ? (
        <section
          className="detail-section"
          aria-label={t("Opportunity closure", "공고 마감")}
        >
          {closureStatus === "closed" ? (
            <p role="status">
              {t("The opportunity is closed.", "공고가 마감되었습니다.")}
            </p>
          ) : closureStatus === "confirming" ? (
            <>
              <p>
                {t(
                  "Closing stops new applications and cannot be undone.",
                  "마감하면 새 지원을 받지 않으며 되돌릴 수 없습니다.",
                )}
              </p>
              <div className="button-row">
                <button type="button" onClick={() => void confirmClosure()}>
                  {t("Confirm closure", "공고 마감 확정")}
                </button>
                <button
                  className="button--secondary"
                  type="button"
                  onClick={() => setClosure(undefined)}
                >
                  {t("Cancel", "취소")}
                </button>
              </div>
            </>
          ) : (
            <>
              <button
                className="button--secondary"
                type="button"
                disabled={closureStatus === "pending"}
                onClick={() =>
                  setClosure({ opportunityId, status: "confirming" })
                }
              >
                {closureStatus === "pending"
                  ? t("Closing opportunity…", "공고를 마감하고 있습니다…")
                  : t("Close opportunity", "공고 마감")}
              </button>
              {closureStatus === "error" ? (
                <p role="alert">
                  {t(
                    "Could not close the opportunity. Try again.",
                    "공고를 마감하지 못했습니다. 다시 시도해 주세요.",
                  )}
                </p>
              ) : null}
            </>
          )}
        </section>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {applications === undefined && error === undefined ? (
        <p role="status">
          {t("Loading applications…", "지원 내역을 불러오고 있습니다…")}
        </p>
      ) : null}
      {applications?.length === 0 ? (
        <p>{t("No applications yet.", "아직 지원 내역이 없습니다.")}</p>
      ) : null}
      {applications?.map((application) => (
        <ApplicationCard key={application.id} application={application} />
      ))}
    </main>
  );
}
