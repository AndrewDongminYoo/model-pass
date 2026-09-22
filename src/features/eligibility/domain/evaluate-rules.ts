import type {
  AnswerValue,
  Answers,
  EvaluationContext,
  EvaluationResult,
  RuleDefinition,
  RuleOutcome,
} from "./types";

export function evaluateRules(
  answers: Answers,
  rules: readonly RuleDefinition[],
  context: EvaluationContext,
): EvaluationResult {
  const failures: RuleOutcome[] = [];
  const reviews: RuleOutcome[] = [];
  const reminders: RuleOutcome[] = [];

  for (const rule of rules) {
    const input = answers[rule.field] ?? null;

    if (passesRule(input, rule)) {
      continue;
    }

    const outcome = Object.freeze({
      ruleId: rule.id,
      reason: rule.reason,
      effect: rule.effect,
      input,
    });

    switch (rule.effect) {
      case "hard_fail":
        failures.push(outcome);
        break;
      case "needs_review":
        reviews.push(outcome);
        break;
      case "reminder":
        reminders.push(outcome);
        break;
      default: {
        const unhandledEffect: never = rule.effect;
        throw new Error(`Unhandled rule effect: ${unhandledEffect}`);
      }
    }
  }

  return Object.freeze({
    rulesetId: context.rulesetId,
    rulesetVersion: context.rulesetVersion,
    eligible: failures.length === 0,
    failures: Object.freeze(failures),
    reviews: Object.freeze(reviews),
    reminders: Object.freeze(reminders),
  });
}

function passesRule(answer: AnswerValue, rule: RuleDefinition): boolean {
  if (answer === null) {
    return false;
  }

  switch (rule.operator) {
    case "equals":
      return answer === rule.expected;
    case "not_equals":
      return answer !== rule.expected;
    case "one_of":
      return rule.expected.includes(answer);
    case "none_of":
      return !rule.expected.includes(answer);
    case "minimum":
      return typeof answer === "number" && answer >= rule.expected;
    case "maximum":
      return typeof answer === "number" && answer <= rule.expected;
    default: {
      const unhandledOperator: never = rule;
      throw new Error(`Unhandled rule operator: ${unhandledOperator}`);
    }
  }
}
