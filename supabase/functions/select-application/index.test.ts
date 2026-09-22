import {
  createSelectApplicationHandler,
  type SelectApplicationDependencies,
} from "./index.ts";

type TestFunction = () => void | Promise<void>;
type TestRegistrar = (name: string, testFunction: TestFunction) => void;
const registerTest: TestRegistrar =
  "Deno" in globalThis
    ? Deno.test
    : (globalThis as typeof globalThis & { it: TestRegistrar }).it;

const applicationId = "00000000-0000-4000-8000-000000000011";
const opportunityId = "00000000-0000-4000-8000-000000000001";
const recruiterId = "00000000-0000-4000-8000-000000000041";

registerTest(
  "persists selection only for the authenticated recruiter owner",
  async () => {
    // Production break: accepting a caller-supplied recruiter ID or skipping ownership lets another account select the application.
    const selectedBy: string[] = [];
    const dependencies: SelectApplicationDependencies = {
      authenticate: (token) =>
        Promise.resolve(token === "owner-token" ? recruiterId : null),
      selectOwnedApplication: (input) => {
        if (
          input.recruiterId !== recruiterId ||
          input.applicationId !== applicationId ||
          input.opportunityId !== opportunityId
        ) {
          return Promise.resolve(null);
        }
        selectedBy.push(input.recruiterId);
        return Promise.resolve({
          applicationId,
          selectedAt: "2026-09-22T03:00:00.000Z",
        });
      },
    };

    const response = await createSelectApplicationHandler(dependencies)(
      request("owner-token"),
    );

    assertEquals(response.status, 200);
    assertEquals(await response.json(), {
      applicationId,
      selectedAt: "2026-09-22T03:00:00.000Z",
    });
    assertEquals(selectedBy, [recruiterId]);
  },
);

registerTest("rejects an unauthenticated selection", async () => {
  // Production break: allowing an anonymous decision gives an applicant or observer recruiter authority.
  let selected = false;
  const dependencies: SelectApplicationDependencies = {
    authenticate: () => Promise.resolve(null),
    selectOwnedApplication: () => {
      selected = true;
      return Promise.resolve(null);
    },
  };

  const response =
    await createSelectApplicationHandler(dependencies)(request());

  assertEquals(response.status, 401);
  assertEquals(selected, false);
});

registerTest("does not reveal another recruiter's application", async () => {
  // Production break: distinguishing another owner's application leaks private application existence.
  const dependencies: SelectApplicationDependencies = {
    authenticate: () => Promise.resolve("other-recruiter"),
    selectOwnedApplication: () => Promise.resolve(null),
  };

  const response = await createSelectApplicationHandler(dependencies)(
    request("other-token"),
  );

  assertEquals(response.status, 404);
  assertEquals(await response.json(), { error: "Application not found." });
});

function request(accessToken?: string) {
  return new Request("http://localhost/functions/v1/select-application", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken === undefined
        ? {}
        : { Authorization: `Bearer ${accessToken}` }),
    },
    body: JSON.stringify({ applicationId, opportunityId }),
  });
}

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${JSON.stringify(
        actual,
      )}`,
    );
  }
}
