import { createPhotoViewHandler, type PhotoViewDependencies } from "./index.ts";

type TestFunction = () => void | Promise<void>;
type TestRegistrar = (name: string, testFunction: TestFunction) => void;

const registerTest: TestRegistrar =
  "Deno" in globalThis
    ? Deno.test
    : (globalThis as typeof globalThis & { it: TestRegistrar }).it;

const applicationId = "00000000-0000-4000-8000-000000000101";
const photoId = "00000000-0000-4000-8000-000000000301";
const recruiterId = "00000000-0000-4000-8000-000000000401";
const storagePath =
  "opportunity/00000000-0000-4000-8000-000000000001/application/00000000-0000-4000-8000-000000000101/00000000-0000-4000-8000-000000000301";

registerTest(
  "returns a 600-second view URL for the recruiter who owns the application",
  async () => {
    // Production break: signing before ownership verification exposes a private photo to any authenticated recruiter.
    const signedDurations: number[] = [];
    const dependencies: PhotoViewDependencies = {
      authenticate: (token) =>
        Promise.resolve(token === "owner" ? recruiterId : null),
      loadOwnedPhoto: (userId, requestedApplicationId, requestedPhotoId) =>
        Promise.resolve(
          userId === recruiterId &&
            requestedApplicationId === applicationId &&
            requestedPhotoId === photoId
            ? { storagePath }
            : null,
        ),
      createSignedViewUrl: (_path, expiresIn) => {
        signedDurations.push(expiresIn);
        return Promise.resolve("https://storage.test/signed-photo");
      },
    };
    const response = await createPhotoViewHandler(dependencies)(
      request("Bearer owner"),
    );

    assertEquals(response.status, 200);
    assertEquals(await response.json(), {
      viewUrl: "https://storage.test/signed-photo",
      expiresIn: 600,
    });
    assertEquals(signedDurations, [600]);
  },
);

registerTest("returns no URL to another recruiter", async () => {
  // Production break: checking only that a recruiter is signed in leaks another recruiter's job-scoped photo.
  let signed = false;
  const dependencies: PhotoViewDependencies = {
    authenticate: () => Promise.resolve("other-recruiter"),
    loadOwnedPhoto: () => Promise.resolve(null),
    createSignedViewUrl: () => {
      signed = true;
      return Promise.resolve("https://storage.test/should-not-exist");
    },
  };
  const response = await createPhotoViewHandler(dependencies)(
    request("Bearer other"),
  );

  assertEquals(response.status, 404);
  assertEquals(signed, false);
  assertEquals("viewUrl" in ((await response.json()) as object), false);
});

registerTest("rejects an unauthenticated view request", async () => {
  // Production break: accepting a missing bearer token makes private photo access anonymous.
  let loaded = false;
  const dependencies: PhotoViewDependencies = {
    authenticate: () => Promise.resolve(null),
    loadOwnedPhoto: () => {
      loaded = true;
      return Promise.resolve({ storagePath });
    },
    createSignedViewUrl: () =>
      Promise.resolve("https://storage.test/should-not-exist"),
  };
  const response = await createPhotoViewHandler(dependencies)(request());

  assertEquals(response.status, 401);
  assertEquals(loaded, false);
  assertEquals("viewUrl" in ((await response.json()) as object), false);
});

function request(authorization?: string) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (authorization !== undefined) {
    headers.set("Authorization", authorization);
  }
  return new Request("http://localhost/functions/v1/create-photo-view", {
    method: "POST",
    headers,
    body: JSON.stringify({ applicationId, photoId }),
  });
}

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}
