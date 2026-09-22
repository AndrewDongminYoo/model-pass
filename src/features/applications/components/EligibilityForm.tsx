import type { FormEvent } from "react";
import { useState } from "react";
import { evaluateRules } from "../../eligibility/domain/evaluate-rules";
import type {
  AnswerValue,
  EvaluationContext,
  EvaluationResult,
  RuleDefinition,
} from "../../eligibility/domain/types";

interface EligibilityFormProps {
  rules: readonly RuleDefinition[];
  context: EvaluationContext;
  answers: Record<string, AnswerValue>;
  onAnswersChange: (answers: Record<string, AnswerValue>) => void;
  onEvaluate: (result: EvaluationResult) => void;
}

interface Question {
  field: string;
  label: string;
  answerType: "boolean" | "number" | "text";
}

export function EligibilityForm({
  rules,
  context,
  answers,
  onAnswersChange,
  onEvaluate,
}: EligibilityFormProps) {
  const questions = questionsFor(rules);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function setAnswer(field: string, value: AnswerValue) {
    setErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    onAnswersChange({ ...answers, [field]: value });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = Object.fromEntries(
      questions
        .filter(({ field }) => answers[field] === undefined)
        .map(({ field, answerType }) => [
          field,
          answerType === "boolean" ? "Choose yes or no." : "Enter an answer.",
        ]),
    );
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    onEvaluate(evaluateRules(answers, rules, context));
  }

  return (
    <form noValidate onSubmit={handleSubmit}>
      <h2>Check eligibility</h2>
      {questions.map((question) => {
        const errorId = `${question.field}-eligibility-error`;
        const error = errors[question.field];

        if (question.answerType === "boolean") {
          return (
            <fieldset
              key={question.field}
              aria-describedby={error ? errorId : undefined}
              aria-invalid={error ? true : undefined}
            >
              <legend>{question.label}</legend>
              <label>
                <input
                  type="radio"
                  name={question.field}
                  value="yes"
                  checked={answers[question.field] === true}
                  onChange={() => setAnswer(question.field, true)}
                />
                Yes
              </label>
              <label>
                <input
                  type="radio"
                  name={question.field}
                  value="no"
                  checked={answers[question.field] === false}
                  onChange={() => setAnswer(question.field, false)}
                />
                No
              </label>
              {error ? <p id={errorId}>{error}</p> : null}
            </fieldset>
          );
        }

        const inputId = `${question.field}-answer`;
        return (
          <div key={question.field}>
            <label htmlFor={inputId}>{question.label}</label>
            <input
              id={inputId}
              type={question.answerType === "number" ? "number" : "text"}
              value={String(answers[question.field] ?? "")}
              aria-describedby={error ? errorId : undefined}
              aria-invalid={error ? true : undefined}
              onChange={(event) =>
                setAnswer(
                  question.field,
                  question.answerType === "number"
                    ? event.currentTarget.valueAsNumber
                    : event.currentTarget.value,
                )
              }
            />
            {error ? <p id={errorId}>{error}</p> : null}
          </div>
        );
      })}
      <button type="submit">Check eligibility</button>
    </form>
  );
}

function questionsFor(rules: readonly RuleDefinition[]): Question[] {
  const questions = new Map<string, Question>();
  for (const rule of rules) {
    if (
      rule.field.toLowerCase().includes("photo") ||
      questions.has(rule.field)
    ) {
      continue;
    }

    const expected = Array.isArray(rule.expected)
      ? rule.expected[0]
      : rule.expected;
    questions.set(rule.field, {
      field: rule.field,
      label: humanizeField(rule.field),
      answerType:
        typeof expected === "boolean"
          ? "boolean"
          : typeof expected === "number"
            ? "number"
            : "text",
    });
  }
  return [...questions.values()];
}

function humanizeField(field: string): string {
  const words = field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}
