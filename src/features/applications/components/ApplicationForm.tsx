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

const initialContactValues: ContactValues = {
  displayName: "",
  phone: "",
  birthDate: "",
  currentApplicationConsent: false,
  futureOpportunityConsent: false,
};

interface PendingPhotoCapability {
  applicationId: string;
  submissionAttemptId: string;
  rulesetId: string;
  rulesetVersion: number;
  expiresAt: string;
}

const pendingPhotoStoragePrefix = "model-pass:pending-photo:";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ApplicationForm({ opportunity }: ApplicationFormProps) {
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
  const [errors, setErrors] = useState<Partial<Record<ContactField, string>>>(
    {},
  );
  const [submitError, setSubmitError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [receiptId, setReceiptId] = useState<string>();
  const [photo, setPhoto] = useState<File>();
  const [photoError, setPhotoError] = useState<string>();
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
          setReceiptId(status.applicationId);
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
  }, [opportunity.id, restoredPendingPhoto]);

  if (receiptId !== undefined) {
    return (
      <section aria-labelledby="application-received-heading">
        <h2 id="application-received-heading">Application received</h2>
        <p>Receipt: {receiptId}</p>
        <p>Keep this private receipt for your records.</p>
      </section>
    );
  }

  if (restorationStatus === "checking") {
    return <p role="status">Checking photo application status.</p>;
  }

  if (restorationStatus === "unavailable") {
    return (
      <p role="alert">This photo application can no longer be resumed.</p>
    );
  }

  if (restorationStatus === "error") {
    return (
      <p role="alert">
        Could not check this photo application. Reload to try again.
      </p>
    );
  }

  if (
    pendingPhotoApplication !== undefined &&
    opportunityRequestsPhoto(opportunity)
  ) {
    return (
      <section aria-labelledby="photo-required-heading">
        <h2 id="photo-required-heading">Photo required to finish</h2>
        <label htmlFor="job-specific-photo">Job-specific photo</label>
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
        <p>JPEG, PNG, HEIC, or HEIF. Maximum 10 MiB.</p>
        <button
          type="button"
          disabled={photo === undefined || photoPending}
          onClick={() =>
            void handlePhotoUpload(pendingPhotoApplication.applicationId)
          }
        >
          {photoPending ? "Uploading photo" : "Upload photo"}
        </button>
        {photoError ? <p role="alert">{photoError}</p> : null}
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
      setReceiptId(result.applicationId);
      setPendingPhotoApplication(undefined);
    } catch {
      setPhotoError("Could not upload the photo. Try again.");
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
        setReceiptId(result.applicationId);
      }
    } catch (error) {
      if (error instanceof ApplicationSubmissionError) {
        if (error.evaluation !== undefined && !error.evaluation.eligible) {
          setEvaluation(error.evaluation);
          setShowApplication(false);
          setSubmitError(undefined);
        } else {
          setSubmitError(error.message);
        }
      } else {
        setSubmitError("Could not submit the application. Try again.");
      }
    } finally {
      submittingRef.current = false;
      setPending(false);
    }
  }

  return (
    <>
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
        <form noValidate onSubmit={handleSubmit}>
          <h2>Application details</h2>
          <TextField
            id="applicant-display-name"
            label="Display name"
            value={contact.displayName}
            error={errors.displayName}
            onChange={(value) => setContactValue("displayName", value)}
          />
          <TextField
            id="applicant-phone"
            label="Phone number"
            type="tel"
            value={contact.phone}
            error={errors.phone}
            onChange={(value) => setContactValue("phone", value)}
          />
          <TextField
            id="applicant-birth-date"
            label="Birth date"
            type="date"
            value={contact.birthDate}
            error={errors.birthDate}
            onChange={(value) => setContactValue("birthDate", value)}
          />
          <CheckboxField
            id="current-application-consent"
            label="Consent to this application"
            checked={contact.currentApplicationConsent}
            error={errors.currentApplicationConsent}
            onChange={(checked) =>
              setContactValue("currentApplicationConsent", checked)
            }
          />
          <CheckboxField
            id="future-opportunity-consent"
            label="Future opportunity alerts"
            checked={contact.futureOpportunityConsent}
            onChange={(checked) =>
              setContactValue("futureOpportunityConsent", checked)
            }
          />
          {submitError ? <p role="alert">{submitError}</p> : null}
          <button type="submit" disabled={pending}>
            {pending ? "Submitting application" : "Submit application"}
          </button>
        </form>
      ) : null}
    </>
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
    <div>
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
    <div>
      <label htmlFor={id}>
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
): Partial<Record<ContactField, string>> {
  const errors: Partial<Record<ContactField, string>> = {};
  if (contact.displayName.trim() === "") {
    errors.displayName = "Enter your display name.";
  }
  if (contact.phone.trim() === "") {
    errors.phone = "Enter your phone number.";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(contact.birthDate)) {
    errors.birthDate = "Enter your birth date.";
  }
  if (!contact.currentApplicationConsent) {
    errors.currentApplicationConsent =
      "Consent is required for this application.";
  }
  return errors;
}
