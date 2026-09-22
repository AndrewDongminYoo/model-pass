import {
  PhotoUploadError,
  createPhotoUploadHandler,
  type PhotoApplication,
  type PhotoMetadata,
  type PhotoUploadDependencies,
} from "./index.ts";

type TestFunction = () => void | Promise<void>;
type TestRegistrar = (name: string, testFunction: TestFunction) => void;

const registerTest: TestRegistrar =
  "Deno" in globalThis
    ? Deno.test
    : (globalThis as typeof globalThis & { it: TestRegistrar }).it;

const opportunityId = "00000000-0000-4000-8000-000000000001";
const applicationId = "00000000-0000-4000-8000-000000000101";
const submissionAttemptId = "00000000-0000-4000-8000-000000000201";
const photoId = "00000000-0000-4000-8000-000000000301";
const now = new Date("2026-09-22T03:00:00.000Z");
const functionUrl = "http://localhost/functions/v1/create-photo-upload";

registerTest(
  "issues an upload grant only for the exact completed application tuple",
  async () => {
    // Production break: looking up by application ID alone lets a leaked receipt target another job or attempt.
    const fixture = createFixture();
    const handler = createPhotoUploadHandler(fixture.dependencies, functionUrl);

    const response = await issueGrant(handler, {
      applicationId,
      opportunityId: "00000000-0000-4000-8000-000000000099",
      submissionAttemptId,
      contentType: "image/jpeg",
      byteSize: 3,
    });

    assertEquals(response.status, 404);
    assertEquals(fixture.uploads.length, 0);
  },
);

registerTest(
  "expires the path-bound upload grant at exactly 600 seconds",
  async () => {
    // Production break: a longer or boundary-inclusive token exposes sensitive upload authority beyond ten minutes.
    const fixture = createFixture();
    const handler = createPhotoUploadHandler(fixture.dependencies, functionUrl);
    const grant = (await readJson(
      await issueGrant(handler, validGrantRequest()),
    )) as { uploadUrl: string; storagePath: string; expiresAt: string };

    assertEquals(grant.storagePath, expectedPath());
    assertEquals(grant.expiresAt, "2026-09-22T03:10:00.000Z");
    fixture.setNow(new Date("2026-09-22T03:10:00.000Z"));

    const expired = await upload(handler, grant, bytes(3), "image/jpeg");
    assertEquals(expired.status, 401);
    assertEquals(fixture.uploads.length, 0);
  },
);

registerTest(
  "rejects changed paths, MIME types, body sizes, and signatures",
  async () => {
    // Production break: accepting any changed signed field turns one job-scoped grant into general storage access.
    for (const mutation of ["path", "type", "size", "signature"] as const) {
      const fixture = createFixture();
      const handler = createPhotoUploadHandler(
        fixture.dependencies,
        functionUrl,
      );
      const grant = (await readJson(
        await issueGrant(handler, validGrantRequest()),
      )) as { uploadUrl: string; storagePath: string };
      let uploadUrl = grant.uploadUrl;
      let storagePath = grant.storagePath;
      let contentType = "image/jpeg";
      let body = bytes(3);

      if (mutation === "path") {
        storagePath = `${grant.storagePath}-changed`;
      } else if (mutation === "type") {
        contentType = "image/png";
      } else if (mutation === "size") {
        body = bytes(4);
      } else {
        const url = new URL(uploadUrl);
        const token = url.searchParams.get("token") ?? "";
        url.searchParams.set("token", `${token.slice(0, -1)}x`);
        uploadUrl = url.toString();
      }

      const response = await upload(
        handler,
        { uploadUrl, storagePath },
        body,
        contentType,
      );

      assert(
        response.status >= 400,
        `${mutation} mutation should fail, received ${response.status}`,
      );
      assertEquals(fixture.uploads.length, 0);
    }
  },
);

registerTest(
  "rejects disallowed MIME types and files above 10 MiB before issuing a grant",
  async () => {
    // Production break: issuing a token for unsupported or oversized content bypasses the private bucket contract.
    const fixture = createFixture();
    const handler = createPhotoUploadHandler(fixture.dependencies, functionUrl);

    const wrongType = await issueGrant(handler, {
      ...validGrantRequest(),
      contentType: "image/gif",
    });
    const tooLarge = await issueGrant(handler, {
      ...validGrantRequest(),
      byteSize: 10 * 1024 * 1024 + 1,
    });

    assertEquals(wrongType.status, 415);
    assertEquals(tooLarge.status, 413);
  },
);

registerTest(
  "uploads without upsert and inserts metadata only after storage succeeds",
  async () => {
    // Production break: enabling upsert or recording metadata first lets a token overwrite or advertise a missing object.
    const fixture = createFixture();
    const handler = createPhotoUploadHandler(fixture.dependencies, functionUrl);
    const grant = (await readJson(
      await issueGrant(handler, validGrantRequest()),
    )) as { uploadUrl: string; storagePath: string };

    const response = await upload(handler, grant, bytes(3), "image/jpeg");

    assertEquals(response.status, 201);
    assertEquals(fixture.events, ["storage", "metadata"]);
    assertEquals(fixture.uploads[0]?.path, expectedPath());
    assertEquals(fixture.uploads[0]?.options, { upsert: false });
    assertEquals(fixture.metadata[0], {
      id: photoId,
      applicationId,
      storagePath: expectedPath(),
      contentType: "image/jpeg",
      byteSize: 3,
      expiresAt: "2026-10-22T03:00:00.000Z",
    });
  },
);

registerTest(
  "removes the exact object when metadata insertion fails",
  async () => {
    // Production break: leaving an untracked private object defeats retention cleanup and data inventory.
    const fixture = createFixture({ metadataFailure: true });
    const handler = createPhotoUploadHandler(fixture.dependencies, functionUrl);
    const grant = (await readJson(
      await issueGrant(handler, validGrantRequest()),
    )) as { uploadUrl: string; storagePath: string };

    const response = await upload(handler, grant, bytes(3), "image/jpeg");

    assertEquals(response.status, 500);
    assertEquals(fixture.removals, [expectedPath()]);
    assertEquals(fixture.events, ["storage", "metadata", "remove"]);
  },
);

registerTest("does not overwrite or reuse an uploaded object", async () => {
  // Production break: reusing the same grant replaces a job-scoped photo after the recruiter reviewed it.
  const fixture = createFixture();
  const handler = createPhotoUploadHandler(fixture.dependencies, functionUrl);
  const grant = (await readJson(
    await issueGrant(handler, validGrantRequest()),
  )) as { uploadUrl: string; storagePath: string };

  assertEquals(
    (await upload(handler, grant, bytes(3), "image/jpeg")).status,
    201,
  );
  assertEquals(
    (await upload(handler, grant, bytes(3), "image/jpeg")).status,
    409,
  );
  assertEquals(fixture.metadata.length, 1);
});

function createFixture(options: { metadataFailure?: boolean } = {}) {
  let currentTime = now;
  const application: PhotoApplication = {
    applicationId,
    opportunityId,
    submissionAttemptId,
    closesAt: "2026-09-30T03:00:00.000Z",
    closedAt: "2026-09-22T03:00:00.000Z",
  };
  const uploads: Array<{
    path: string;
    contentType: string;
    body: Uint8Array;
    options: { upsert: false };
  }> = [];
  const metadata: PhotoMetadata[] = [];
  const removals: string[] = [];
  const events: string[] = [];
  const storedPaths = new Set<string>();
  const dependencies: PhotoUploadDependencies = {
    now: () => currentTime,
    createPhotoId: () => photoId,
    signingSecret: "test-signing-secret-with-sufficient-length",
    async loadApplication(input) {
      if (
        input.applicationId !== application.applicationId ||
        input.opportunityId !== application.opportunityId ||
        input.submissionAttemptId !== application.submissionAttemptId
      ) {
        return null;
      }
      return application;
    },
    async uploadObject(path, body, contentType, uploadOptions) {
      if (storedPaths.has(path)) {
        throw new PhotoUploadError("This photo was already uploaded.", 409);
      }
      events.push("storage");
      storedPaths.add(path);
      uploads.push({ path, body, contentType, options: uploadOptions });
    },
    async insertMetadata(value) {
      events.push("metadata");
      if (options.metadataFailure) {
        throw new Error("metadata failed");
      }
      metadata.push(value);
    },
    async removeObject(path) {
      events.push("remove");
      storedPaths.delete(path);
      removals.push(path);
    },
    reportError() {},
  };

  return {
    dependencies,
    events,
    metadata,
    removals,
    uploads,
    setNow(value: Date) {
      currentTime = value;
    },
  };
}

function validGrantRequest() {
  return {
    applicationId,
    opportunityId,
    submissionAttemptId,
    contentType: "image/jpeg",
    byteSize: 3,
  };
}

function expectedPath() {
  return `opportunity/${opportunityId}/application/${applicationId}/${photoId}`;
}

function issueGrant(
  handler: (request: Request) => Promise<Response>,
  body: Record<string, unknown>,
) {
  return handler(
    new Request(functionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function upload(
  handler: (request: Request) => Promise<Response>,
  grant: { uploadUrl: string; storagePath: string },
  body: Uint8Array,
  contentType: string,
) {
  return handler(
    new Request(grant.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        "X-Photo-Storage-Path": grant.storagePath,
      },
      body: body.buffer as ArrayBuffer,
    }),
  );
}

function bytes(length: number): Uint8Array {
  return new Uint8Array(length).fill(1);
}

async function readJson(response: Response): Promise<unknown> {
  return await response.json();
}

function assert(condition: unknown, message = "Expected condition to be true") {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}
