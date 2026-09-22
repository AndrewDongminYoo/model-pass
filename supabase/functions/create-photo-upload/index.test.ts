import {
  PhotoUploadError,
  createPhotoUploadHandler,
  validatePhotoUploadSigningSecret,
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
  "rejects a non-photo application and recovers an already finalized photo",
  async () => {
    // Production break: a valid application tuple is not photo authority, while a lost success response must remain recoverable.
    const nonPhoto = createFixture({ photoRequired: false });
    assertEquals(
      (
        await issueGrant(
          createPhotoUploadHandler(nonPhoto.dependencies, functionUrl),
          validGrantRequest(),
        )
      ).status,
      409,
    );

    const recovered = createFixture({
      submissionState: "submitted",
      completedPhotoId: photoId,
    });
    const response = await issueGrant(
      createPhotoUploadHandler(recovered.dependencies, functionUrl),
      validGrantRequest(),
    );
    assertEquals(response.status, 200);
    assertEquals(await readJson(response), {
      applicationId,
      photoId,
      submissionState: "submitted",
    });
    assertEquals(recovered.uploads.length, 0);
  },
);

registerTest(
  "rechecks photo-required pending state before accepting the PUT",
  async () => {
    // Production break: a signed token is not authority after the stored application stops being pending_photo.
    for (const mutation of ["not-required", "submitted"] as const) {
      const fixture = createFixture();
      const handler = createPhotoUploadHandler(
        fixture.dependencies,
        functionUrl,
      );
      const grant = (await readJson(
        await issueGrant(handler, validGrantRequest()),
      )) as { uploadUrl: string; storagePath: string };
      if (mutation === "not-required") {
        fixture.setPhotoRequired(false);
      } else {
        fixture.setSubmissionState("submitted");
      }

      const response = await upload(handler, grant, bytes(3), "image/jpeg");
      assertEquals(response.status, 409);
      assertEquals(fixture.uploads.length, 0);
    }
  },
);

registerTest("rejects grant minting after the opportunity closes", async () => {
  // Production break: checking closure only during PUT still mints unnecessary upload authority for a closed job.
  const fixture = createFixture();
  fixture.closeOpportunity("2026-09-22T03:00:00.000Z");
  const response = await issueGrant(
    createPhotoUploadHandler(fixture.dependencies, functionUrl),
    validGrantRequest(),
  );

  assertEquals(response.status, 409);
  assertEquals(fixture.uploads.length, 0);
});

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
  "bounds a chunked public grant body before JSON parsing",
  async () => {
    // Production break: request.json buffers an unbounded anonymous body before validating its fields.
    const fixture = createFixture();
    const handler = createPhotoUploadHandler(fixture.dependencies, functionUrl);
    const response = await handler(
      streamingRequest("POST", functionUrl, [bytes(3_000), bytes(2_000)], {
        "Content-Type": "application/json",
      }),
    );

    assertEquals(response.status, 413);
    assertEquals(fixture.getApplicationLoadCount(), 0);
  },
);

registerTest(
  "bounds a chunked photo body without trusting Content-Length",
  async () => {
    // Production break: arrayBuffer buffers a chunked body beyond its signed byte limit before rejection.
    const fixture = createFixture();
    const handler = createPhotoUploadHandler(fixture.dependencies, functionUrl);
    const grant = (await readJson(
      await issueGrant(handler, validGrantRequest()),
    )) as { uploadUrl: string; storagePath: string };
    const response = await handler(
      streamingRequest("PUT", grant.uploadUrl, [bytes(2), bytes(2)], {
        "Content-Type": "image/jpeg",
        "X-Photo-Storage-Path": grant.storagePath,
      }),
    );

    assertEquals(response.status, 413);
    assertEquals(fixture.uploads.length, 0);
  },
);

registerTest(
  "rejects a non-canonical Content-Length before reading the photo",
  async () => {
    // Production break: parseInt accepts ambiguous values such as 3junk or 03 as a signed size.
    const fixture = createFixture();
    const handler = createPhotoUploadHandler(fixture.dependencies, functionUrl);
    const grant = (await readJson(
      await issueGrant(handler, validGrantRequest()),
    )) as { uploadUrl: string; storagePath: string };
    const response = await handler(
      new Request(grant.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "image/jpeg",
          "Content-Length": "03",
          "X-Photo-Storage-Path": grant.storagePath,
        },
        body: bytes(3).buffer as ArrayBuffer,
      }),
    );

    assertEquals(response.status, 400);
    assertEquals(fixture.uploads.length, 0);
  },
);

registerTest("rejects weak and documented-placeholder signing secrets", () => {
  // Production break: booting with a short or copied example secret makes anonymous grants forgeable.
  for (const secret of [
    undefined,
    "short-secret",
    "가".repeat(10),
    "replace-with-at-least-32-random-bytes",
  ]) {
    assertThrows(() => validatePhotoUploadSigningSecret(secret));
  }
  assertEquals(
    validatePhotoUploadSigningSecret("가".repeat(11)),
    "가".repeat(11),
  );
});

registerTest(
  "rejects a PUT when the opportunity closes after grant minting",
  async () => {
    // Production break: treating signed claims as current authority permits upload after the opportunity closes.
    const fixture = createFixture();
    const handler = createPhotoUploadHandler(fixture.dependencies, functionUrl);
    const grant = (await readJson(
      await issueGrant(handler, validGrantRequest()),
    )) as { uploadUrl: string; storagePath: string };
    fixture.closeOpportunity("2026-09-22T03:01:00.000Z");

    const response = await upload(handler, grant, bytes(3), "image/jpeg");

    assertEquals(response.status, 409);
    assertEquals(fixture.uploads.length, 0);
    assertEquals(fixture.reservations.length, 0);
  },
);

registerTest(
  "uses authoritative closure state immediately before metadata insertion",
  async () => {
    // Production break: retention copied into the grant becomes stale if the opportunity close timestamp changes during upload.
    const fixture = createFixture({
      closesAtAfterStorage: "2026-10-01T03:00:00.000Z",
    });
    const handler = createPhotoUploadHandler(fixture.dependencies, functionUrl);
    const grant = (await readJson(
      await issueGrant(handler, validGrantRequest()),
    )) as { uploadUrl: string; storagePath: string };

    const response = await upload(handler, grant, bytes(3), "image/jpeg");

    assertEquals(response.status, 201);
    assertEquals(fixture.metadata[0]?.expiresAt, "2026-10-31T03:00:00.000Z");
    assertEquals(fixture.getApplicationLoadCount(), 3);
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
    assertEquals(fixture.events, ["reserve", "storage", "finalize"]);
    assertEquals(fixture.uploads[0]?.path, expectedPath());
    assertEquals(fixture.uploads[0]?.options, { upsert: false });
    assertEquals(fixture.metadata[0], {
      id: photoId,
      applicationId,
      storagePath: expectedPath(),
      contentType: "image/jpeg",
      byteSize: 3,
      expiresAt: "2026-10-30T03:00:00.000Z",
    });
    assertEquals((await readJson(response)), {
      applicationId,
      photoId,
      submissionState: "submitted",
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
    assertEquals(fixture.events, [
      "reserve",
      "storage",
      "finalize",
      "verify",
      "remove",
      "release",
    ]);
  },
);

registerTest(
  "returns the exact committed upload when finalization response is lost",
  async () => {
    // Production break: compensating after a committed RPC response loss deletes the storage object referenced by submitted metadata.
    const fixture = createFixture({ finalizationCommittedResponseLoss: true });
    const handler = createPhotoUploadHandler(fixture.dependencies, functionUrl);
    const grant = (await readJson(
      await issueGrant(handler, validGrantRequest()),
    )) as { uploadUrl: string; storagePath: string };

    const response = await upload(handler, grant, bytes(3), "image/jpeg");

    assertEquals(response.status, 201);
    assertEquals(await readJson(response), {
      applicationId,
      photoId,
      submissionState: "submitted",
    });
    assertEquals(fixture.events, ["reserve", "storage", "finalize", "verify"]);
    assertEquals(fixture.removals, []);
    assertEquals(fixture.reservations, []);
  },
);

registerTest(
  "retains storage and reservation when finalization status is ambiguous",
  async () => {
    // Production break: deleting storage when the exact commit check errors can break a committed submitted application.
    const fixture = createFixture({
      metadataFailure: true,
      finalizationVerificationFailure: true,
    });
    const handler = createPhotoUploadHandler(fixture.dependencies, functionUrl);
    const grant = (await readJson(
      await issueGrant(handler, validGrantRequest()),
    )) as { uploadUrl: string; storagePath: string };

    const response = await upload(handler, grant, bytes(3), "image/jpeg");

    assertEquals(response.status, 500);
    assertEquals(fixture.events, ["reserve", "storage", "finalize", "verify"]);
    assertEquals(fixture.removals, []);
    assertEquals(fixture.reservations, [expectedPath()]);
  },
);

registerTest(
  "retains a durable reservation when metadata and compensation both fail",
  async () => {
    // Production break: logging a failed delete without durable state makes the private object undiscoverable.
    const fixture = createFixture({
      metadataFailure: true,
      removalFailure: true,
    });
    const handler = createPhotoUploadHandler(fixture.dependencies, functionUrl);
    const grant = (await readJson(
      await issueGrant(handler, validGrantRequest()),
    )) as { uploadUrl: string; storagePath: string };

    const response = await upload(handler, grant, bytes(3), "image/jpeg");

    assertEquals(response.status, 500);
    assertEquals(fixture.reservations, [expectedPath()]);
    assertEquals(fixture.events, [
      "reserve",
      "storage",
      "finalize",
      "verify",
      "remove",
    ]);
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

function createFixture(
  options: {
    closesAtAfterStorage?: string;
    metadataFailure?: boolean;
    removalFailure?: boolean;
    photoRequired?: boolean;
    submissionState?: "pending_photo" | "submitted";
    completedPhotoId?: string;
    finalizationCommittedResponseLoss?: boolean;
    finalizationVerificationFailure?: boolean;
  } = {},
) {
  let currentTime = now;
  let applicationLoadCount = 0;
  const application: PhotoApplication = {
    applicationId,
    opportunityId,
    submissionAttemptId,
    closesAt: "2026-09-30T03:00:00.000Z",
    closedAt: null,
    status: "published",
    photoRequired: options.photoRequired ?? true,
    submissionState: options.submissionState ?? "pending_photo",
  };
  const uploads: Array<{
    path: string;
    contentType: string;
    body: Uint8Array;
    options: { upsert: false };
  }> = [];
  const metadata: PhotoMetadata[] = [];
  const removals: string[] = [];
  const reservations: string[] = [];
  const events: string[] = [];
  const storedPaths = new Set<string>();
  const dependencies: PhotoUploadDependencies = {
    now: () => currentTime,
    createPhotoId: () => photoId,
    signingSecret: "test-signing-secret-with-sufficient-length",
    async loadApplication(input) {
      applicationLoadCount += 1;
      if (
        input.applicationId !== application.applicationId ||
        input.opportunityId !== application.opportunityId ||
        input.submissionAttemptId !== application.submissionAttemptId
      ) {
        return null;
      }
      return application;
    },
    async reserveUpload(value) {
      events.push("reserve");
      reservations.push(value.storagePath);
    },
    async uploadObject(path, body, contentType, uploadOptions) {
      if (storedPaths.has(path)) {
        throw new PhotoUploadError("This photo was already uploaded.", 409);
      }
      events.push("storage");
      storedPaths.add(path);
      uploads.push({ path, body, contentType, options: uploadOptions });
      if (options.closesAtAfterStorage !== undefined) {
        application.closesAt = options.closesAtAfterStorage;
      }
    },
    async finalizeUpload(value) {
      events.push("finalize");
      if (options.metadataFailure) {
        throw new Error("metadata failed");
      }
      metadata.push(value);
      application.submissionState = "submitted";
      const index = reservations.indexOf(value.storagePath);
      if (index >= 0) {
        reservations.splice(index, 1);
      }
      if (options.finalizationCommittedResponseLoss) {
        throw new Error("finalization response lost");
      }
      return {
        applicationId,
        photoId: value.id,
        submissionState: "submitted" as const,
      };
    },
    async removeObject(path) {
      events.push("remove");
      if (options.removalFailure) {
        throw new Error("remove failed");
      }
      storedPaths.delete(path);
      removals.push(path);
    },
    async releaseReservation(value) {
      events.push("release");
      const index = reservations.indexOf(value);
      if (index >= 0) {
        reservations.splice(index, 1);
      }
    },
    async loadCompletedPhoto(input) {
      if (
        options.completedPhotoId !== undefined &&
        input.applicationId === applicationId
      ) {
        return {
          applicationId,
          photoId: options.completedPhotoId,
          submissionState: "submitted" as const,
        };
      }
      return null;
    },
    async loadExactFinalizedUpload(value, tuple) {
      events.push("verify");
      if (options.finalizationVerificationFailure) {
        throw new Error("verification unavailable");
      }
      const exact = metadata.find(
        (candidate) =>
          candidate.id === value.id &&
          candidate.applicationId === value.applicationId &&
          candidate.storagePath === value.storagePath &&
          candidate.contentType === value.contentType &&
          candidate.byteSize === value.byteSize,
      );
      if (
        exact === undefined ||
        tuple.applicationId !== application.applicationId ||
        tuple.opportunityId !== application.opportunityId ||
        tuple.submissionAttemptId !== application.submissionAttemptId ||
        application.submissionState !== "submitted"
      ) {
        return null;
      }
      return {
        applicationId: exact.applicationId,
        photoId: exact.id,
        submissionState: "submitted" as const,
      };
    },
    reportError() {},
  };

  return {
    dependencies,
    events,
    metadata,
    removals,
    reservations,
    uploads,
    closeOpportunity(closedAt: string) {
      application.closedAt = closedAt;
      application.status = "closed";
    },
    getApplicationLoadCount() {
      return applicationLoadCount;
    },
    setNow(value: Date) {
      currentTime = value;
    },
    setPhotoRequired(value: boolean) {
      application.photoRequired = value;
    },
    setSubmissionState(value: "pending_photo" | "submitted") {
      application.submissionState = value;
    },
  };
}

function streamingRequest(
  method: "POST" | "PUT",
  url: string,
  chunks: Uint8Array[],
  headers: Record<string, string>,
): Request {
  let chunkIndex = 0;
  const requestInit: RequestInit & { duplex: "half" } = {
    method,
    headers,
    duplex: "half",
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[chunkIndex];
        chunkIndex += 1;
        if (chunk === undefined) {
          controller.close();
        } else {
          controller.enqueue(chunk);
        }
      },
    }),
  };
  return new Request(url, requestInit);
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

function assertThrows(action: () => unknown) {
  try {
    action();
  } catch {
    return;
  }
  throw new Error("Expected action to throw");
}
