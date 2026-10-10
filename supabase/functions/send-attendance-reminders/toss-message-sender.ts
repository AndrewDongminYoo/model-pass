import type { ReminderClaim, SendOutcome } from "./index.ts";

// Partner API call for the attendance reminder. The request shape follows the
// smart-message documentation; it is unverified against the live API until the
// QR smoke test in GitHub issue #16 runs with a real certificate and key.
const SEND_MESSAGE_URL =
  "https://apps-in-toss-api.toss.im/api-partner/v1/apps-in-toss/messenger/send-message";
const REQUEST_TIMEOUT_MS = 10_000;

// Placeholder variable names: the console template (GitHub issue #15) decides
// the real ones. Change them here only.
export const TEMPLATE_CONTEXT_KEYS = {
  appointmentTime: "appointmentTime",
  venueDistrict: "venueDistrict",
} as const;

const sentCountFields = [
  "sentPushCount",
  "sentInboxCount",
  "sentSmsCount",
  "sentAlimtalkCount",
  "sentFriendtalkCount",
] as const;

export function reminderContext(claim: ReminderClaim): Record<string, string> {
  return {
    [TEMPLATE_CONTEXT_KEYS.appointmentTime]: new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(claim.startsAt)),
    [TEMPLATE_CONTEXT_KEYS.venueDistrict]: claim.venueDistrict,
  };
}

// Maps a partner response to the spec's outcome classes
// (docs/specs/2026-10-10-ait-attendance-reminder.md §Server Call).
export function classifySendResponse(
  status: number,
  bodyText: string,
): SendOutcome {
  if (status === 401 || status === 403) {
    return { kind: "configuration", code: `HTTP_${status}` };
  }
  if (status >= 400 && status < 500) {
    return { kind: "failed", code: `HTTP_${status}` };
  }
  if (status < 200 || status >= 300) {
    return { kind: "ambiguous", code: `HTTP_${status}` };
  }

  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return { kind: "ambiguous", code: "UNRECOGNIZED_RESPONSE" };
  }
  if (typeof body !== "object" || body === null) {
    return { kind: "ambiguous", code: "UNRECOGNIZED_RESPONSE" };
  }
  const response = body as {
    resultType?: unknown;
    success?: Record<string, unknown>;
    error?: { errorCode?: unknown };
  };
  if (response.resultType === "FAIL") {
    const errorCode = response.error?.errorCode;
    return {
      kind: "failed",
      code:
        typeof errorCode === "string" && errorCode.length > 0
          ? errorCode.slice(0, 200)
          : "FAIL",
    };
  }
  if (
    response.resultType === "SUCCESS" &&
    typeof response.success === "object" &&
    response.success !== null &&
    sentCountFields.every((field) =>
      Number.isSafeInteger(response.success?.[field]),
    )
  ) {
    const delivered = sentCountFields.reduce(
      (total, field) => total + (response.success?.[field] as number),
      0,
    );
    return delivered > 0
      ? { kind: "sent" }
      : { kind: "failed", code: "NOT_DELIVERED" };
  }
  return { kind: "ambiguous", code: "UNRECOGNIZED_RESPONSE" };
}

export function createTossMessageSender(options: {
  templateSetCode: string;
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>;
}) {
  return async (claim: ReminderClaim): Promise<SendOutcome> => {
    let response: Response;
    let bodyText: string;
    try {
      response = await options.fetchImpl(SEND_MESSAGE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-anon-key": claim.anonKey,
        },
        body: JSON.stringify({
          templateSetCode: options.templateSetCode,
          context: reminderContext(claim),
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      bodyText = await response.text();
    } catch {
      // The request may have reached the partner, so this is never retried.
      return { kind: "ambiguous", code: "NETWORK" };
    }
    return classifySendResponse(response.status, bodyText);
  };
}
