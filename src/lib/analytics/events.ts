import { z } from "zod";
import type { AttendanceEventType } from "../../features/attendance/domain/attendance";
import type { OpportunityCategory } from "../../features/opportunities/domain/opportunity";

export type PilotEvent =
  | { name: "opportunity_previewed"; category: OpportunityCategory }
  | { name: "application_started"; opportunityId: string }
  | {
      name: "eligibility_checked";
      opportunityId: string;
      eligible: boolean;
    }
  | { name: "application_submitted"; opportunityId: string }
  | {
      name: "attendance_recorded";
      opportunityId: string;
      outcome: AttendanceEventType;
    };

const opportunityIdSchema = z.string().min(1);

const pilotEventSchema: z.ZodType<PilotEvent> = z.discriminatedUnion("name", [
  z
    .object({
      name: z.literal("opportunity_previewed"),
      category: z.enum(["hair_promotion", "makeup_certification"]),
    })
    .strict(),
  z
    .object({
      name: z.literal("application_started"),
      opportunityId: opportunityIdSchema,
    })
    .strict(),
  z
    .object({
      name: z.literal("eligibility_checked"),
      opportunityId: opportunityIdSchema,
      eligible: z.boolean(),
    })
    .strict(),
  z
    .object({
      name: z.literal("application_submitted"),
      opportunityId: opportunityIdSchema,
    })
    .strict(),
  z
    .object({
      name: z.literal("attendance_recorded"),
      opportunityId: opportunityIdSchema,
      outcome: z.enum([
        "recruiter_confirmed",
        "applicant_confirmed",
        "completed",
        "recruiter_cancelled",
        "applicant_cancelled",
        "recruiter_no_show",
        "applicant_no_show",
        "dispute_opened",
        "dispute_resolved",
      ]),
    })
    .strict(),
]);

export function parsePilotEvent(input: unknown): PilotEvent {
  return pilotEventSchema.parse(input);
}
