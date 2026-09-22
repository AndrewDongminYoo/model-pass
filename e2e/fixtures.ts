import { randomUUID } from "node:crypto";
import {
  createClient,
  type Session,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { test as base, type BrowserContextOptions } from "@playwright/test";
import { hairPromotionV1 } from "../src/features/eligibility/templates/hair-promotion-v1";
import {
  makeupCertificationV1,
  makeupCertificationV1Metadata,
} from "../src/features/eligibility/templates/makeup-certification-v1";
import type { RuleDefinition } from "../src/features/eligibility/domain/types";
import type { OpportunityCategory } from "../src/features/opportunities/domain/opportunity";
import { resolveLocalSupabaseEnvironment } from "./local-supabase";

export const e2eBaseUrl = "http://127.0.0.1:4173";

type BrowserStorageState = Exclude<
  BrowserContextOptions["storageState"],
  string | undefined
>;

interface RecruiterFixture {
  opportunityId: string;
  storageState: BrowserStorageState;
}

interface PilotData {
  hairOpportunityId: string;
  makeupOpportunityId: string;
  recruiterOne: RecruiterFixture;
  recruiterTwo: RecruiterFixture;
}

export const test = base.extend<object, { pilotData: PilotData }>({
  pilotData: [
    async ({ browserName }, use) => {
      if (browserName !== "chromium") {
        throw new Error("The pilot E2E fixture requires Chromium.");
      }
      const environment = resolveLocalSupabaseEnvironment();
      const serviceClient = createClient(
        environment.apiUrl,
        environment.serviceRoleKey,
        {
          auth: { autoRefreshToken: false, persistSession: false },
        },
      );
      const anonClient = createClient(environment.apiUrl, environment.anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const suffix = randomUUID();
      const recruiterOne = await createRecruiter(
        serviceClient,
        anonClient,
        `recruiter-one-${suffix}@model-pass.test`,
      );
      const recruiterTwo = await createRecruiter(
        serviceClient,
        anonClient,
        `recruiter-two-${suffix}@model-pass.test`,
      );

      const hairOpportunityId = await createOpportunity(serviceClient, {
        recruiterId: recruiterOne.id,
        category: "hair_promotion",
        title: "Gangnam hair promotion model",
        benefit: {
          type: "procedure",
          description: "Hair treatment at no charge",
        },
        rulesetId: "hair-promotion",
        rulesetVersion: 1,
        rules: hairPromotionV1.filter(
          (rule) => !rule.field.toLowerCase().includes("photo"),
        ),
      });
      const makeupOpportunityId = await createOpportunity(serviceClient, {
        recruiterId: recruiterTwo.id,
        category: "makeup_certification",
        title: "Gangnam makeup certification model",
        benefit: {
          type: "cash",
          amount: 50_000,
          description: "Paid after the session",
        },
        rulesetId: makeupCertificationV1Metadata.id,
        rulesetVersion: makeupCertificationV1Metadata.version,
        rules: makeupCertificationV1,
      });

      const recruiterOneOpportunityId = await createOpportunity(serviceClient, {
        recruiterId: recruiterOne.id,
        category: "hair_promotion",
        title: "Recruiter one private opportunity",
        benefit: {
          type: "procedure",
          description: "Private fixture procedure",
        },
        rulesetId: "isolation-fixture",
        rulesetVersion: 1,
        rules: [],
      });
      const recruiterTwoOpportunityId = await createOpportunity(serviceClient, {
        recruiterId: recruiterTwo.id,
        category: "makeup_certification",
        title: "Recruiter two private opportunity",
        benefit: {
          type: "cash",
          amount: 10_000,
          description: "Private fixture payment",
        },
        rulesetId: "isolation-fixture",
        rulesetVersion: 1,
        rules: [],
      });
      await createSubmittedApplication(
        serviceClient,
        recruiterOneOpportunityId,
        "Recruiter One Applicant",
        "01011112222",
      );
      await createSubmittedApplication(
        serviceClient,
        recruiterTwoOpportunityId,
        "Recruiter Two Applicant",
        "01033334444",
      );

      const storageKey = `sb-${new URL(environment.apiUrl).hostname.split(".")[0]}-auth-token`;
      await use({
        hairOpportunityId,
        makeupOpportunityId,
        recruiterOne: {
          opportunityId: recruiterOneOpportunityId,
          storageState: storageState(storageKey, recruiterOne.session),
        },
        recruiterTwo: {
          opportunityId: recruiterTwoOpportunityId,
          storageState: storageState(storageKey, recruiterTwo.session),
        },
      });
    },
    { scope: "worker" },
  ],
});

export { expect } from "@playwright/test";

async function createRecruiter(
  serviceClient: SupabaseClient,
  anonClient: SupabaseClient,
  email: string,
): Promise<{ id: string; session: Session }> {
  const password = "Local-e2e-password-1!";
  const { data: created, error: createError } =
    await serviceClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
  if (createError !== null || created.user === null) {
    throw new Error("Could not create an E2E recruiter.");
  }

  const { data: authenticated, error: signInError } =
    await anonClient.auth.signInWithPassword({ email, password });
  if (signInError !== null || authenticated.session === null) {
    throw new Error("Could not authenticate an E2E recruiter.");
  }

  return { id: created.user.id, session: authenticated.session };
}

async function createOpportunity(
  serviceClient: SupabaseClient,
  input: {
    recruiterId: string;
    category: OpportunityCategory;
    title: string;
    benefit:
      | { type: "procedure"; description: string }
      | { type: "cash"; amount: number; description: string };
    rulesetId: string;
    rulesetVersion: number;
    rules: readonly RuleDefinition[];
  },
): Promise<string> {
  const startsAt = new Date(Date.now() + 8 * 24 * 60 * 60 * 1_000);
  const closesAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000);
  const { data, error } = await serviceClient
    .from("opportunities")
    .insert({
      recruiter_id: input.recruiterId,
      category: input.category,
      title: input.title,
      starts_at: startsAt.toISOString(),
      closes_at: closesAt.toISOString(),
      venue_district: "서울 강남구",
      expected_minutes: 120,
      benefit: input.benefit,
      status: "published",
      ruleset_id: input.rulesetId,
      ruleset_version: input.rulesetVersion,
      rules_snapshot: input.rules,
      confirmed_hard_rule_ids: input.rules
        .filter((rule) => rule.effect === "hard_fail")
        .map((rule) => rule.id),
    })
    .select("id")
    .single<{ id: string }>();
  if (error !== null || data === null) {
    throw new Error("Could not seed an E2E opportunity.");
  }
  return data.id;
}

async function createSubmittedApplication(
  serviceClient: SupabaseClient,
  opportunityId: string,
  applicantDisplayName: string,
  applicantPhone: string,
): Promise<void> {
  const evaluation = {
    rulesetId: "isolation-fixture",
    rulesetVersion: 1,
    eligible: true,
    failures: [],
    reviews: [],
    reminders: [],
  };
  const { error } = await serviceClient.from("applications").insert({
    opportunity_id: opportunityId,
    submission_attempt_id: randomUUID(),
    submission_fingerprint: randomUUID().replaceAll("-", "").repeat(2),
    applicant_display_name: applicantDisplayName,
    applicant_phone: applicantPhone,
    applicant_birth_date: "1990-01-01",
    ruleset_id: "isolation-fixture",
    ruleset_version: 1,
    rules_snapshot: [],
    evaluation_snapshot: evaluation,
  });
  if (error !== null) {
    throw new Error("Could not seed an E2E application.");
  }
}

function storageState(
  storageKey: string,
  session: Session,
): BrowserStorageState {
  return {
    cookies: [],
    origins: [
      {
        origin: e2eBaseUrl,
        localStorage: [{ name: storageKey, value: JSON.stringify(session) }],
      },
    ],
  };
}
