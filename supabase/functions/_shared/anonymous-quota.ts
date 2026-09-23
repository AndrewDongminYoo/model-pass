export async function hashAnonymousRequestSource(
  request: Request,
  secret: string,
): Promise<string | null> {
  const forwardedFor = request.headers.get("X-Forwarded-For");
  const clientIp = forwardedFor?.split(",", 1)[0]?.trim();
  if (clientIp === undefined || !/^[0-9a-fA-F:.]{3,45}$/.test(clientIp)) {
    return null;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(clientIp),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
