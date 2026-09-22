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

export function ApplicationsPage() {
  const { locale, t } = useI18n();
  const { opportunityId } = useParams<{ opportunityId: string }>();
  const [result, setResult] = useState<{
    opportunityId: string;
    applications?: RecruiterApplication[];
    error?: string;
  }>();

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
                ? loadError.message
                : "지원 내역을 불러오지 못했습니다.",
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
      : currentResult?.error;
  const applications = currentResult?.applications;

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
      {error ? <p role="alert">{localizeLoadError(error, locale)}</p> : null}
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

function localizeLoadError(message: string, locale: "ko" | "en"): string {
  if (message === "Sign in to review applications.") {
    return locale === "ko" ? "지원 내역을 보려면 로그인해 주세요." : message;
  }
  if (locale === "ko") return message;
  if (message === "이 공고를 볼 수 없습니다.")
    return "This opportunity is unavailable.";
  if (message === "지원 내역을 불러오지 못했습니다.")
    return "Could not load applications.";
  return message;
}
