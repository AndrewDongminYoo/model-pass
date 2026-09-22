import {
  cleanupExpiredPhotos,
  createCleanupExpiredPhotosHandler,
  createSupabaseDependencies,
  type CleanupDependencies,
  type CleanupPhoto,
  type StaleReservation,
} from "./index.ts";

type TestFunction = () => void | Promise<void>;
type TestRegistrar = (name: string, testFunction: TestFunction) => void;
const registerTest: TestRegistrar =
  "Deno" in globalThis
    ? Deno.test
    : (globalThis as typeof globalThis & { it: TestRegistrar }).it;

registerTest(
  "deletes only expired unheld photos and is idempotent",
  async () => {
    // Production break: ignoring retention time, holds, or deleted metadata removes protected photos or repeats deletion.
    const state = cleanupState();
    const first = await cleanupExpiredPhotos(false, state.dependencies);
    const second = await cleanupExpiredPhotos(false, state.dependencies);

    assertEquals(first.photos.deleted, 1);
    assertEquals(first.photos.held, 1);
    assertEquals(second.photos.deleted, 0);
    assertEquals(state.removed, ["expired"]);
  },
);

registerTest(
  "reconciles reservations before deleting a closed pending draft",
  async () => {
    // Production break: deleting the application first cascades away the only database record for an orphaned storage object.
    const order: string[] = [];
    let reservations: StaleReservation[] = [
      reservation("metadata", true),
      reservation("orphan", false),
    ];
    let pendingDrafts = 1;
    const dependencies = emptyDependencies({
      listStaleReservations: () => Promise.resolve([...reservations]),
      removeObject: (path) => {
        order.push(`remove:${path}`);
        return Promise.resolve();
      },
      deleteReservation: (item) => {
        order.push(`reservation:${item.storagePath}`);
        reservations = reservations.filter((entry) => entry.id !== item.id);
        return Promise.resolve(true);
      },
      countPendingDrafts: () =>
        Promise.resolve(reservations.length === 0 ? pendingDrafts : 0),
      deletePendingDrafts: () => {
        order.push("drafts");
        const deleted = pendingDrafts;
        pendingDrafts = 0;
        return Promise.resolve(deleted);
      },
    });

    const result = await cleanupExpiredPhotos(false, dependencies);
    const repeated = await cleanupExpiredPhotos(false, dependencies);

    assertEquals(order, [
      "reservation:metadata",
      "remove:orphan",
      "reservation:orphan",
      "drafts",
      "drafts",
    ]);
    assertEquals(result.reservations.metadataMatched, 1);
    assertEquals(result.reservations.orphansDeleted, 1);
    assertEquals(result.pendingDrafts, { eligible: 0, deleted: 1 });
    assertEquals(repeated.reservations.orphansDeleted, 0);
    assertEquals(repeated.reservations.metadataMatched, 0);
    assertEquals(repeated.pendingDrafts, { eligible: 0, deleted: 0 });
  },
);

registerTest(
  "dry-run and authorization do not mutate storage or metadata",
  async () => {
    // Production break: treating dry-run as cosmetic or skipping operator authorization creates destructive public cleanup.
    const state = cleanupState();
    const unauthorized = await createCleanupExpiredPhotosHandler(
      state.dependencies,
    )(
      new Request("http://localhost/functions/v1/cleanup-expired-photos", {
        method: "POST",
        body: JSON.stringify({ dryRun: false }),
      }),
    );
    state.authorized = true;
    const dryRun = await createCleanupExpiredPhotosHandler(state.dependencies)(
      new Request("http://localhost/functions/v1/cleanup-expired-photos", {
        method: "POST",
        headers: { Authorization: "Bearer operator" },
        body: JSON.stringify({ dryRun: true }),
      }),
    );

    assertEquals(unauthorized.status, 401);
    assertEquals(dryRun.status, 200);
    assertEquals((await dryRun.json()).pendingDrafts, {
      eligible: 2,
      deleted: 0,
    });
    assertEquals(state.removed, []);
  },
);

registerTest(
  "reports a metadata failure without claiming deletion",
  async () => {
    // Production break: a failed metadata write after object removal must remain visible for recovery and retry.
    const reported: string[] = [];
    const result = await cleanupExpiredPhotos(
      false,
      emptyDependencies({
        listExpiredPhotos: () => Promise.resolve([photo("expired", false)]),
        finalizePhotoDeletion: () => Promise.resolve(false),
        reportError: (message) => reported.push(message),
      }),
    );

    assertEquals(result.photos.deleted, 0);
    assertEquals(result.photos.failed, 1);
    assertEquals(reported, [
      "Photo cleanup failed for 00000000-0000-4000-8000-000000000001.",
    ]);
  },
);

registerTest(
  "releases a matching claim when Storage removal fails",
  async () => {
    // Production break: retaining a claim after a definite pre-deletion Storage failure blocks holds and recovery unnecessarily.
    const order: string[] = [];
    const result = await cleanupExpiredPhotos(
      false,
      emptyDependencies({
        listExpiredPhotos: () => Promise.resolve([photo("expired", false)]),
        claimPhoto: () => {
          order.push("claim");
          return Promise.resolve(true);
        },
        removeObject: () => {
          order.push("remove");
          return Promise.reject(new Error("storage rejected removal"));
        },
        releasePhotoClaim: () => {
          order.push("release");
          return Promise.resolve(true);
        },
      }),
    );

    assertEquals(order, ["claim", "remove", "release"]);
    assertEquals(result.photos.failed, 1);
  },
);

registerTest(
  "retains the claim when deletion finalization is uncertain",
  async () => {
    // Production break: releasing after Storage success lets a dispute hold open while deletion evidence is unresolved.
    const order: string[] = [];
    const result = await cleanupExpiredPhotos(
      false,
      emptyDependencies({
        listExpiredPhotos: () => Promise.resolve([photo("expired", false)]),
        claimPhoto: () => {
          order.push("claim");
          return Promise.resolve(true);
        },
        removeObject: () => {
          order.push("remove");
          return Promise.resolve();
        },
        finalizePhotoDeletion: () => {
          order.push("finalize");
          return Promise.resolve(false);
        },
        releasePhotoClaim: () => {
          order.push("release");
          return Promise.resolve(true);
        },
      }),
    );

    assertEquals(order, ["claim", "remove", "finalize"]);
    assertEquals(result.photos.failed, 1);
  },
);

registerTest(
  "stops a chunked oversized cleanup body at the byte limit",
  async () => {
    // Production break: calling request.text() consumes an unbounded no-header stream before checking its size.
    let listed = false;
    const dependencies = emptyDependencies({
      listExpiredPhotos: () => {
        listed = true;
        return Promise.resolve([]);
      },
    });

    const chunked = oversizedChunkedRequest(
      "http://localhost/functions/v1/cleanup-expired-photos",
    );
    const response = await createCleanupExpiredPhotosHandler(dependencies)(
      chunked.request,
    );

    assertEquals(response.status, 413);
    assertEquals(listed, false);
    assertEquals(chunked.getPulls() < 100, true);
  },
);

registerTest("denies an invalid cleanup bearer", async () => {
  // Production break: accepting a failed user lookup authorizes cleanup without an operator or service role.
  const client = {
    auth: {
      getUser: () =>
        Promise.resolve({
          data: { user: null },
          error: new Error("invalid bearer"),
        }),
    },
  };
  const dependencies = createSupabaseDependencies(
    client as never,
    "service-key",
  );

  assertEquals(await dependencies.authorize("invalid-token"), false);
});

function cleanupState() {
  let photos: CleanupPhoto[] = [
    photo("expired", false),
    photo("current", false, "2099-10-01T00:00:00.000Z"),
    photo("held", true),
  ];
  const removed: string[] = [];
  const state = { authorized: false };
  const dependencies = emptyDependencies({
    authorize: () => Promise.resolve(state.authorized),
    listExpiredPhotos: () =>
      Promise.resolve(
        photos.filter((item) => item.expiresAt <= "2026-09-22T00:00:00.000Z"),
      ),
    removeObject: (path) => {
      removed.push(path);
      return Promise.resolve();
    },
    finalizePhotoDeletion: (item) => {
      photos = photos.filter((photoItem) => photoItem.id !== item.id);
      return Promise.resolve(true);
    },
    countPendingDrafts: () => Promise.resolve(2),
  });
  return {
    dependencies,
    removed,
    get authorized() {
      return state.authorized;
    },
    set authorized(value: boolean) {
      state.authorized = value;
    },
  };
}

function emptyDependencies(
  overrides: Partial<CleanupDependencies> = {},
): CleanupDependencies {
  return {
    now: () => new Date("2026-09-22T00:00:00.000Z"),
    createInvocationId: () => "00000000-0000-4000-8000-000000000901",
    authorize: () => Promise.resolve(true),
    listExpiredPhotos: () => Promise.resolve([]),
    listStaleReservations: () => Promise.resolve([]),
    removeObject: () => Promise.resolve(),
    claimPhoto: () => Promise.resolve(true),
    releasePhotoClaim: () => Promise.resolve(true),
    finalizePhotoDeletion: () => Promise.resolve(true),
    deleteReservation: () => Promise.resolve(true),
    countPendingDrafts: () => Promise.resolve(0),
    deletePendingDrafts: () => Promise.resolve(0),
    reportError: () => undefined,
    ...overrides,
  };
}

function photo(
  name: string,
  held: boolean,
  expiresAt = "2026-09-01T00:00:00.000Z",
): CleanupPhoto {
  return {
    id: `00000000-0000-4000-8000-000000000${name === "expired" ? "001" : name === "current" ? "002" : "003"}`,
    storagePath: name,
    expiresAt,
    held,
  };
}

function reservation(
  storagePath: string,
  metadataExists: boolean,
): StaleReservation {
  return {
    id:
      storagePath === "metadata"
        ? "00000000-0000-4000-8000-000000000011"
        : "00000000-0000-4000-8000-000000000012",
    applicationId: "00000000-0000-4000-8000-000000000021",
    storagePath,
    metadataExists,
  };
}

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

function oversizedChunkedRequest(url: string) {
  let pulls = 0;
  const request = new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > 1000) return controller.close();
        controller.enqueue(new Uint8Array(512));
      },
    }),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  return { request, getPulls: () => pulls };
}
