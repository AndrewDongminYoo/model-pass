import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import type {
  AnswerValue,
  EvaluationResult,
} from "../../eligibility/domain/types";
import type { PublicOpportunity } from "../api/get-public-opportunity";
import {
  ApplicationSubmissionError,
  submitApplication,
} from "../api/submit-application";
import {
  getApplicationPhotoStatus,
  uploadApplicationPhoto,
} from "../api/application-photos";
import { AttendanceManager } from "../../attendance/components/AttendanceManager";
import { ApplicantPrivacyControls } from "../../privacy/components/ApplicantPrivacyControls";
import { useI18n } from "../../../i18n/locale";
import { EligibilityForm } from "./EligibilityForm";
import { EligibilityResult } from "./EligibilityResult";

interface ApplicationFormProps {
  opportunity: PublicOpportunity;
}

interface ContactValues {
  displayName: string;
  phone: string;
  birthDate: string;
  currentApplicationConsent: boolean;
  futureOpportunityConsent: boolean;
}

type ContactField = keyof Pick<
  ContactValues,
  "displayName" | "phone" | "birthDate" | "currentApplicationConsent"
>;

interface LocalizedMessage {
  en: string;
  ko: string;
}

const initialContactValues: ContactValues = {
  displayName: "",
  phone: "",
  birthDate: "",
  currentApplicationConsent: false,
  futureOpportunityConsent: false,
};

const initialRecoveryValues: RecoveryValues = {
  applicationId: "",
  submissionAttemptId: "",
};

interface PendingPhotoCapability {
  applicationId: string;
  submissionAttemptId: string;
  rulesetId: string;
  rulesetVersion: number;
  expiresAt: string;
}

interface StoredAttendanceCapability {
  applicationId: string;
  submissionAttemptId: string;
  expiresAt: string;
}

interface RecoveryValues {
  applicationId: string;
  submissionAttemptId: string;
}

const pendingPhotoStoragePrefix = "model-pass:pending-photo:";
const attendanceStoragePrefix = "model-pass:attendance:";
const attendanceRetentionMilliseconds = 30 * 24 * 60 * 60 * 1_000;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ApplicationForm({ opportunity }: ApplicationFormProps) {
  const { t } = useI18n();
  const [restoredAttendanceCapability] = useState(() =>
    loadAttendanceCapability(opportunity),
  );
  const [restoredPendingPhoto] = useState(() =>
    loadPendingPhotoCapability(opportunity),
  );
  const [submissionAttemptId] = useState(
    () => restoredPendingPhoto?.submissionAttemptId ?? crypto.randomUUID(),
  );
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [evaluation, setEvaluation] = useState<EvaluationResult>();
  const [showApplication, setShowApplication] = useState(false);
  const [contact, setContact] = useState(initialContactValues);
  const [errors, setErrors] = useState<
    Partial<Record<ContactField, LocalizedMessage>>
  >({});
  const [submitError, setSubmitError] = useState<LocalizedMessage>();
  const [pending, setPending] = useState(false);
  const [receiptCapability, setReceiptCapability] = useState<
    StoredAttendanceCapability | undefined
  >(restoredAttendanceCapability);
  const [recovery, setRecovery] = useState(initialRecoveryValues);
  const [recoveryError, setRecoveryError] = useState<LocalizedMessage>();
  const [photo, setPhoto] = useState<File>();
  const [photoError, setPhotoError] = useState<LocalizedMessage>();
  const [photoPending, setPhotoPending] = useState(false);
  const [pendingPhotoApplication, setPendingPhotoApplication] = useState<{
    applicationId: string;
  }>();
  const [restorationStatus, setRestorationStatus] = useState<
    "idle" | "checking" | "unavailable" | "error"
  >(restoredPendingPhoto === undefined ? "idle" : "checking");
  const submittingRef = useRef(false);
  const photoUploadingRef = useRef(false);

  useEffect(() => {
    if (restoredPendingPhoto === undefined) {
      return;
    }
    let active = true;
    void getApplicationPhotoStatus({
      applicationId: restoredPendingPhoto.applicationId,
      opportunityId: opportunity.id,
      submissionAttemptId: restoredPendingPhoto.submissionAttemptId,
    })
      .then((status) => {
        if (!active) {
          return;
        }
        if (status.status === "submitted") {
          clearPendingPhotoCapability(opportunity.id);
          const capability = attendanceCapability(
            opportunity,
            status.applicationId,
            restoredPendingPhoto.submissionAttemptId,
          );
          saveAttendanceCapability(opportunity.id, capability);
          setReceiptCapability(capability);
          setRestorationStatus("idle");
          return;
        }
        if (status.status === "pending") {
          setPendingPhotoApplication({
            applicationId: restoredPendingPhoto.applicationId,
          });
          setRestorationStatus("idle");
          return;
        }
        clearPendingPhotoCapability(opportunity.id);
        setRestorationStatus("unavailable");
      })
      .catch(() => {
        if (active) {
          setRestorationStatus("error");
        }
      });
    return () => {
      active = false;
    };
  }, [opportunity, restoredPendingPhoto]);

  if (receiptCapability !== undefined) {
    return (
      <section
        className="surface"
        aria-labelledby="application-received-heading"
      >
        <h2 id="application-received-heading">
          {t("Application received", "지원서를 받았습니다")}
        </h2>
        <p className="code-value">
          {t("Application ID", "접수 번호")}: {receiptCapability.applicationId}
        </p>
        <p className="code-value">
          {t("Private management code", "비공개 관리 코드")}:{" "}
          {receiptCapability.submissionAttemptId}
        </p>
        <p className="callout callout--warning">
          {t(
            "Keep your private management code and do not share it with anyone.",
            "비공개 관리 코드를 보관하고 다른 사람에게 공유하지 마세요.",
          )}
        </p>
        <AttendanceManager
          capability={{
            applicationId: receiptCapability.applicationId,
            opportunityId: opportunity.id,
            submissionAttemptId: receiptCapability.submissionAttemptId,
          }}
          viewerParty="applicant"
        />
        <ApplicantPrivacyControls
          capability={{
            applicationId: receiptCapability.applicationId,
            opportunityId: opportunity.id,
            submissionAttemptId: receiptCapability.submissionAttemptId,
          }}
        />
      </section>
    );
  }

  if (restorationStatus === "checking") {
    return (
      <p role="status">
        {t(
          "Checking photo submission status…",
          "사진 제출 상태를 확인하고 있습니다…",
        )}
      </p>
    );
  }

  if (restorationStatus === "unavailable") {
    return (
      <p role="alert">
        {t(
          "This photo submission can no longer be resumed.",
          "이 사진 제출은 더 이상 이어서 진행할 수 없습니다.",
        )}
      </p>
    );
  }

  if (restorationStatus === "error") {
    return (
      <p role="alert">
        {t(
          "We could not check the photo submission status. Refresh and try again.",
          "사진 제출 상태를 확인하지 못했습니다. 새로고침 후 다시 시도해 주세요.",
        )}
      </p>
    );
  }

  if (
    pendingPhotoApplication !== undefined &&
    opportunityRequestsPhoto(opportunity)
  ) {
    return (
      <section className="surface" aria-labelledby="photo-required-heading">
        <h2 id="photo-required-heading">
          {t(
            "Upload a photo to complete your application",
            "사진을 올려야 지원이 완료됩니다",
          )}
        </h2>
        <div className="field">
          <label htmlFor="job-specific-photo">
            {t(
              "Photo requested for this opportunity",
              "이 공고에서 요청한 사진",
            )}
          </label>
          <input
            id="job-specific-photo"
            type="file"
            accept="image/jpeg,image/png,image/heic,image/heif,.heic,.heif"
            disabled={photoPending}
            onChange={(event) => {
              setPhoto(event.currentTarget.files?.[0]);
              setPhotoError(undefined);
            }}
          />
          <p className="helper-text">
            {t(
              "You can upload JPEG, PNG, HEIC, or HEIF files up to 10 MiB.",
              "JPEG, PNG, HEIC, HEIF 파일을 올릴 수 있습니다. 최대 10MiB입니다.",
            )}
          </p>
        </div>
        <button
          type="button"
          disabled={photo === undefined || photoPending}
          onClick={() =>
            void handlePhotoUpload(pendingPhotoApplication.applicationId)
          }
        >
          {photoPending
            ? t("Uploading photo…", "사진을 올리고 있습니다…")
            : t("Upload photo", "사진 올리기")}
        </button>
        {photoError ? <p role="alert">{messageText(photoError, t)}</p> : null}
      </section>
    );
  }

  async function handlePhotoUpload(applicationId: string) {
    if (photo === undefined || photoUploadingRef.current) {
      return;
    }
    photoUploadingRef.current = true;
    setPhotoPending(true);
    setPhotoError(undefined);
    try {
      const result = await uploadApplicationPhoto({
        applicationId,
        opportunityId: opportunity.id,
        submissionAttemptId,
        file: photo,
      });
      if (result.applicationId !== applicationId) {
        throw new Error("The photo upload completed for another application.");
      }
      clearPendingPhotoCapability(opportunity.id);
      const capability = attendanceCapability(
        opportunity,
        result.applicationId,
        submissionAttemptId,
      );
      saveAttendanceCapability(opportunity.id, capability);
      setReceiptCapability(capability);
      setPendingPhotoApplication(undefined);
    } catch {
      setPhotoError(
        message(
          "We could not upload the photo. Try again.",
          "사진을 올리지 못했습니다. 다시 시도해 주세요.",
        ),
      );
    } finally {
      photoUploadingRef.current = false;
      setPhotoPending(false);
    }
  }

  function changeAnswers(nextAnswers: Record<string, AnswerValue>) {
    setAnswers(nextAnswers);
    setEvaluation(undefined);
    setShowApplication(false);
  }

  function setContactValue(
    field: keyof ContactValues,
    value: string | boolean,
  ) {
    setContact((current) => ({ ...current, [field]: value }));
    if (
      field === "displayName" ||
      field === "phone" ||
      field === "birthDate" ||
      field === "currentApplicationConsent"
    ) {
      setErrors((current) => {
        const next = { ...current };
        delete next[field];
        return next;
      });
    }
  }

  function handleRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const applicationId = recovery.applicationId.trim();
    const submissionAttemptId = recovery.submissionAttemptId.trim();
    if (
      !uuidPattern.test(applicationId) ||
      !uuidPattern.test(submissionAttemptId)
    ) {
      setRecoveryError(
        message(
          "Enter a valid application ID and private management code.",
          "올바른 접수 번호와 비공개 관리 코드를 입력해 주세요.",
        ),
      );
      return;
    }
    setReceiptCapability({
      applicationId,
      submissionAttemptId,
      expiresAt: attendanceCapabilityExpiresAt(opportunity),
    });
    setRecoveryError(undefined);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) {
      return;
    }

    const nextErrors = validateContact(contact);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    submittingRef.current = true;
    setPending(true);
    setSubmitError(undefined);
    try {
      const result = await submitApplication({
        opportunityId: opportunity.id,
        submissionAttemptId,
        applicant: {
          displayName: contact.displayName.trim(),
          phone: contact.phone.trim(),
          birthDate: contact.birthDate,
        },
        answers: Object.fromEntries(
          Object.entries(answers).filter(([field]) => field !== "isAdult"),
        ),
        currentApplicationConsent: true,
        futureOpportunityConsent: contact.futureOpportunityConsent,
      });
      if (result.submissionState === "pending_photo") {
        if (!hasRequestedPhotoOutcome(opportunity, result.evaluation)) {
          throw new Error("The pending photo response is invalid.");
        }
        setPendingPhotoApplication({
          applicationId: result.applicationId,
        });
        savePendingPhotoCapability(opportunity, {
          applicationId: result.applicationId,
          submissionAttemptId,
          rulesetId: opportunity.rulesetId,
          rulesetVersion: opportunity.rulesetVersion,
          expiresAt: opportunity.closesAt,
        });
      } else {
        clearPendingPhotoCapability(opportunity.id);
        const capability = attendanceCapability(
          opportunity,
          result.applicationId,
          submissionAttemptId,
        );
        saveAttendanceCapability(opportunity.id, capability);
        setReceiptCapability(capability);
      }
    } catch (error) {
      if (error instanceof ApplicationSubmissionError) {
        if (error.evaluation !== undefined && !error.evaluation.eligible) {
          setEvaluation(error.evaluation);
          setShowApplication(false);
          setSubmitError(undefined);
        } else {
          setSubmitError(localizedSubmissionError(error.message));
        }
      } else {
        setSubmitError(
          message(
            "We could not submit your application. Try again.",
            "지원서를 제출하지 못했습니다. 다시 시도해 주세요.",
          ),
        );
      }
    } finally {
      submittingRef.current = false;
      setPending(false);
    }
  }

  return (
    <div className="section-stack">
      <details className="surface surface--subtle recovery-panel">
        <summary>
          {t("Find an existing application", "기존 지원 내역 찾기")}
        </summary>
        <form className="form-stack" noValidate onSubmit={handleRecovery}>
          <div className="field">
            <label htmlFor="recovery-application-id">
              {t("Application ID", "접수 번호")}
            </label>
            <input
              id="recovery-application-id"
              type="text"
              value={recovery.applicationId}
              aria-describedby={recoveryError ? "recovery-error" : undefined}
              aria-invalid={recoveryError ? true : undefined}
              onChange={(event) => {
                const applicationId = event.currentTarget.value;
                setRecovery((current) => ({
                  ...current,
                  applicationId,
                }));
                setRecoveryError(undefined);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="recovery-private-management-code">
              {t("Private management code", "비공개 관리 코드")}
            </label>
            <input
              id="recovery-private-management-code"
              type="text"
              value={recovery.submissionAttemptId}
              aria-describedby={recoveryError ? "recovery-error" : undefined}
              aria-invalid={recoveryError ? true : undefined}
              onChange={(event) => {
                const submissionAttemptId = event.currentTarget.value;
                setRecovery((current) => ({
                  ...current,
                  submissionAttemptId,
                }));
                setRecoveryError(undefined);
              }}
            />
          </div>
          {recoveryError ? (
            <p id="recovery-error" role="alert">
              {messageText(recoveryError, t)}
            </p>
          ) : null}
          <button className="button--secondary" type="submit">
            {t("View application", "지원 내역 확인")}
          </button>
        </form>
      </details>
      <EligibilityForm
        rules={opportunity.rules}
        context={{
          rulesetId: opportunity.rulesetId,
          rulesetVersion: opportunity.rulesetVersion,
        }}
        answers={answers}
        onAnswersChange={changeAnswers}
        onEvaluate={setEvaluation}
      />
      {evaluation ? (
        <EligibilityResult
          result={evaluation}
          onContinue={() => setShowApplication(true)}
        />
      ) : null}
      {evaluation?.eligible && showApplication ? (
        <form className="surface form-stack" noValidate onSubmit={handleSubmit}>
          <h2>{t("Applicant information", "지원자 정보")}</h2>
          <TextField
            id="applicant-display-name"
            label={t("Name or preferred name", "이름 또는 별명")}
            value={contact.displayName}
            error={errors.displayName && messageText(errors.displayName, t)}
            onChange={(value) => setContactValue("displayName", value)}
          />
          <TextField
            id="applicant-phone"
            label={t("Phone number", "전화번호")}
            type="tel"
            value={contact.phone}
            error={errors.phone && messageText(errors.phone, t)}
            onChange={(value) => setContactValue("phone", value)}
          />
          <TextField
            id="applicant-birth-date"
            label={t("Date of birth", "생년월일")}
            type="date"
            value={contact.birthDate}
            error={errors.birthDate && messageText(errors.birthDate, t)}
            onChange={(value) => setContactValue("birthDate", value)}
          />
          <CheckboxField
            id="current-application-consent"
            label={t(
              "I consent to personal-data processing for this application.",
              "이 공고 지원을 위한 개인정보 처리에 동의합니다",
            )}
            checked={contact.currentApplicationConsent}
            error={
              errors.currentApplicationConsent &&
              messageText(errors.currentApplicationConsent, t)
            }
            onChange={(checked) =>
              setContactValue("currentApplicationConsent", checked)
            }
          />
          <CheckboxField
            id="future-opportunity-consent"
            label={t(
              "Send me future opportunity alerts (optional)",
              "향후 모집 알림을 받겠습니다(선택)",
            )}
            checked={contact.futureOpportunityConsent}
            onChange={(checked) =>
              setContactValue("futureOpportunityConsent", checked)
            }
          />
          {submitError ? (
            <p role="alert">{messageText(submitError, t)}</p>
          ) : null}
          <button type="submit" disabled={pending}>
            {pending
              ? t("Submitting application…", "지원서를 제출하고 있습니다…")
              : t("Submit application", "지원서 제출")}
          </button>
        </form>
      ) : null}
    </div>
  );
}

function hasRequestedPhotoOutcome(
  opportunity: PublicOpportunity,
  evaluation: EvaluationResult | undefined,
): boolean {
  if (
    evaluation === undefined ||
    evaluation.rulesetId !== opportunity.rulesetId ||
    evaluation.rulesetVersion !== opportunity.rulesetVersion
  ) {
    return false;
  }
  const requestedPhotoRuleIds = new Set(
    opportunity.rules
      .filter(
        (rule) =>
          rule.effect === "needs_review" &&
          rule.field.toLowerCase().includes("photo"),
      )
      .map((rule) => rule.id),
  );
  return evaluation.reviews.some(
    (outcome) =>
      outcome.effect === "needs_review" &&
      requestedPhotoRuleIds.has(outcome.ruleId),
  );
}

function opportunityRequestsPhoto(opportunity: PublicOpportunity): boolean {
  return opportunity.rules.some(
    (rule) =>
      rule.effect === "needs_review" &&
      rule.field.toLowerCase().includes("photo"),
  );
}

function pendingPhotoStorageKey(opportunityId: string): string {
  return `${pendingPhotoStoragePrefix}${opportunityId}`;
}

function loadPendingPhotoCapability(
  opportunity: PublicOpportunity,
): PendingPhotoCapability | undefined {
  const key = pendingPhotoStorageKey(opportunity.id);
  try {
    const stored = localStorage.getItem(key);
    if (stored === null) {
      return undefined;
    }
    const parsed: unknown = JSON.parse(stored);
    if (!isValidPendingPhotoCapability(parsed, opportunity)) {
      localStorage.removeItem(key);
      return undefined;
    }
    return parsed;
  } catch {
    try {
      localStorage.removeItem(key);
    } catch {
      // Browser storage is best-effort; the server remains authoritative.
    }
    return undefined;
  }
}

function isValidPendingPhotoCapability(
  value: unknown,
  opportunity: PublicOpportunity,
): value is PendingPhotoCapability {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const capability = value as Partial<PendingPhotoCapability>;
  const keys = Object.keys(value).sort();
  const expectedKeys = [
    "applicationId",
    "expiresAt",
    "rulesetId",
    "rulesetVersion",
    "submissionAttemptId",
  ];
  const expiresAt =
    typeof capability.expiresAt === "string"
      ? Date.parse(capability.expiresAt)
      : Number.NaN;
  const closesAt = Date.parse(opportunity.closesAt);
  return (
    JSON.stringify(keys) === JSON.stringify(expectedKeys) &&
    typeof capability.applicationId === "string" &&
    uuidPattern.test(capability.applicationId) &&
    typeof capability.submissionAttemptId === "string" &&
    uuidPattern.test(capability.submissionAttemptId) &&
    capability.rulesetId === opportunity.rulesetId &&
    capability.rulesetVersion === opportunity.rulesetVersion &&
    Number.isFinite(expiresAt) &&
    Number.isFinite(closesAt) &&
    expiresAt > Date.now() &&
    expiresAt <= closesAt &&
    opportunityRequestsPhoto(opportunity)
  );
}

function savePendingPhotoCapability(
  opportunity: PublicOpportunity,
  capability: PendingPhotoCapability,
): void {
  try {
    localStorage.setItem(
      pendingPhotoStorageKey(opportunity.id),
      JSON.stringify(capability),
    );
  } catch {
    // Browser storage is best-effort; the in-memory upload step remains usable.
  }
}

function clearPendingPhotoCapability(opportunityId: string): void {
  try {
    localStorage.removeItem(pendingPhotoStorageKey(opportunityId));
  } catch {
    // Browser storage is best-effort; the server remains authoritative.
  }
}

function attendanceStorageKey(opportunityId: string): string {
  return `${attendanceStoragePrefix}${opportunityId}`;
}

function attendanceCapability(
  opportunity: PublicOpportunity,
  applicationId: string,
  submissionAttemptId: string,
): StoredAttendanceCapability {
  return {
    applicationId,
    submissionAttemptId,
    expiresAt: attendanceCapabilityExpiresAt(opportunity),
  };
}

function attendanceCapabilityExpiresAt(opportunity: PublicOpportunity): string {
  return new Date(
    Date.parse(opportunity.startsAt) + attendanceRetentionMilliseconds,
  ).toISOString();
}

function loadAttendanceCapability(
  opportunity: PublicOpportunity,
): StoredAttendanceCapability | undefined {
  const key = attendanceStorageKey(opportunity.id);
  try {
    const stored = localStorage.getItem(key);
    if (stored === null) return undefined;
    const parsed: unknown = JSON.parse(stored);
    if (!isValidAttendanceCapability(parsed, opportunity)) {
      localStorage.removeItem(key);
      return undefined;
    }
    return parsed;
  } catch {
    try {
      localStorage.removeItem(key);
    } catch {
      // Browser storage is best-effort; the server remains authoritative.
    }
    return undefined;
  }
}

function isValidAttendanceCapability(
  value: unknown,
  opportunity: PublicOpportunity,
): value is StoredAttendanceCapability {
  if (typeof value !== "object" || value === null) return false;
  const capability = value as Partial<StoredAttendanceCapability>;
  return (
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify(["applicationId", "expiresAt", "submissionAttemptId"]) &&
    typeof capability.applicationId === "string" &&
    uuidPattern.test(capability.applicationId) &&
    typeof capability.submissionAttemptId === "string" &&
    uuidPattern.test(capability.submissionAttemptId) &&
    capability.expiresAt === attendanceCapabilityExpiresAt(opportunity) &&
    Date.parse(capability.expiresAt) > Date.now()
  );
}

function saveAttendanceCapability(
  opportunityId: string,
  capability: StoredAttendanceCapability,
): void {
  try {
    localStorage.setItem(
      attendanceStorageKey(opportunityId),
      JSON.stringify(capability),
    );
  } catch {
    // Browser storage is best-effort; the in-memory receipt remains usable.
  }
}

interface TextFieldProps {
  id: string;
  label: string;
  type?: "text" | "tel" | "date";
  value: string;
  error?: string;
  onChange: (value: string) => void;
}

function TextField({
  id,
  label,
  type = "text",
  value,
  error,
  onChange,
}: TextFieldProps) {
  const errorId = `${id}-error`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        aria-describedby={error ? errorId : undefined}
        aria-invalid={error ? true : undefined}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      {error ? <p id={errorId}>{error}</p> : null}
    </div>
  );
}

interface CheckboxFieldProps {
  id: string;
  label: string;
  checked: boolean;
  error?: string;
  onChange: (checked: boolean) => void;
}

function CheckboxField({
  id,
  label,
  checked,
  error,
  onChange,
}: CheckboxFieldProps) {
  const errorId = `${id}-error`;
  return (
    <div className="field">
      <label className="choice" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
        {label}
      </label>
      {error ? <p id={errorId}>{error}</p> : null}
    </div>
  );
}

function validateContact(
  contact: ContactValues,
): Partial<Record<ContactField, LocalizedMessage>> {
  const errors: Partial<Record<ContactField, LocalizedMessage>> = {};
  if (contact.displayName.trim() === "") {
    errors.displayName = message(
      "Enter your name or preferred name.",
      "이름 또는 별명을 입력해 주세요.",
    );
  }
  if (contact.phone.trim() === "") {
    errors.phone = message(
      "Enter your phone number.",
      "전화번호를 입력해 주세요.",
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(contact.birthDate)) {
    errors.birthDate = message(
      "Enter your date of birth.",
      "생년월일을 입력해 주세요.",
    );
  }
  if (!contact.currentApplicationConsent) {
    errors.currentApplicationConsent = message(
      "You must consent to personal-data processing to apply for this opportunity.",
      "이 공고에 지원하려면 개인정보 처리에 동의해야 합니다.",
    );
  }
  return errors;
}

function message(en: string, ko: string): LocalizedMessage {
  return { en, ko };
}

function messageText(
  value: LocalizedMessage,
  t: (en: string, ko: string) => string,
): string {
  return t(value.en, value.ko);
}

function localizedSubmissionError(value: string): LocalizedMessage {
  const knownMessages: Record<string, string> = {
    "Applicants must be at least 19 years old.":
      "지원자는 만 19세 이상이어야 합니다.",
    "Submission attempt payload does not match the original application.":
      "이전 지원과 입력 내용이 일치하지 않습니다.",
    "The application does not satisfy this opportunity's rules.":
      "지원서가 이 공고의 조건을 충족하지 않습니다.",
    "Invalid application payload.": "지원서 입력 내용을 확인해 주세요.",
    "Unable to submit the application.":
      "지원서를 제출하지 못했습니다. 다시 시도해 주세요.",
  };
  if (knownMessages[value] !== undefined)
    return message(value, knownMessages[value]);
  return message(
    value,
    "지원서를 처리하지 못했습니다. 내용을 확인한 뒤 다시 시도해 주세요.",
  );
}
