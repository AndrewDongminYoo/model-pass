import { tossAnonKeyPattern } from "../../features/applications/domain/application.ts";

interface AppsInTossUserSdk {
  User: {
    getAnonymousKey: (() => Promise<unknown>) & { isSupported?: () => boolean };
  };
}

// The bridge may never answer outside the Toss app, and submission waits on it.
const captureTimeoutMs = 2_000;

// Vite replaces the surface at build time, so the web bundle drops this import.
const loadAppsInTossSdk: (() => Promise<AppsInTossUserSdk>) | null =
  import.meta.env.VITE_APP_SURFACE === "ait"
    ? () => import("@apps-in-toss/web-framework")
    : null;

// Returns the Apps in Toss recipient key for attendance reminders, or null.
// A missing key must never block an application, so every failure is null.
export async function captureTossAnonymousKey(
  surface: string | undefined = import.meta.env.VITE_APP_SURFACE,
  loadSdk: (() => Promise<AppsInTossUserSdk>) | null = loadAppsInTossSdk,
): Promise<string | null> {
  if (surface !== "ait" || loadSdk === null) {
    return null;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), captureTimeoutMs);
  });
  try {
    return await Promise.race([readAnonymousKey(loadSdk), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function readAnonymousKey(
  loadSdk: () => Promise<AppsInTossUserSdk>,
): Promise<string | null> {
  try {
    const { User } = await loadSdk();
    if (User.getAnonymousKey.isSupported?.() === false) {
      return null;
    }
    const result = await User.getAnonymousKey();
    if (
      typeof result === "object" &&
      result !== null &&
      (result as { type?: unknown }).type === "HASH"
    ) {
      const hash = (result as { hash?: unknown }).hash;
      if (typeof hash === "string" && tossAnonKeyPattern.test(hash)) {
        return hash;
      }
    }
    return null;
  } catch {
    return null;
  }
}
