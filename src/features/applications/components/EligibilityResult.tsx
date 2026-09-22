import type { EvaluationResult } from "../../eligibility/domain/types";

interface EligibilityResultProps {
  result: EvaluationResult;
  onContinue: () => void;
}

export function EligibilityResult({
  result,
  onContinue,
}: EligibilityResultProps) {
  if (!result.eligible) {
    return (
      <section className="surface" aria-labelledby="eligibility-failed-heading">
        <h2 id="eligibility-failed-heading">Not eligible</h2>
        <div role="alert">
          <p>This opportunity cannot accept the answers below.</p>
          <ul>
            {result.failures.map((failure) => (
              <li key={failure.ruleId}>{failure.reason}</li>
            ))}
          </ul>
        </div>
      </section>
    );
  }

  return (
    <section className="surface" aria-labelledby="eligibility-passed-heading">
      <h2 id="eligibility-passed-heading">Eligible to continue</h2>
      {result.reminders.length > 0 ? (
        <div>
          <h3>Appointment reminders</h3>
          <ul>
            {result.reminders.map((reminder) => (
              <li key={reminder.ruleId}>{reminder.reason}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="field">
        <label htmlFor="requested-photo">Requested photo</label>
        <input
          id="requested-photo"
          type="file"
          disabled
          aria-describedby="requested-photo-limitation"
        />
        <p className="helper-text" id="requested-photo-limitation">
          Photo upload is not available in this step. No photo is uploaded or
          submitted with this application yet.
        </p>
      </div>
      <button type="button" onClick={onContinue}>
        Continue to application
      </button>
    </section>
  );
}
