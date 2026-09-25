const opportunityIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function applicantPathFromLink(value: string): string | null {
  const input = value.trim();
  if (opportunityIdPattern.test(input)) {
    return `/opportunities/${input}/apply`;
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  if (url.protocol === "intoss:") {
    if (url.hostname !== "model-pass") return null;
  } else if (url.protocol !== "https:") {
    return null;
  }

  const match = url.pathname.match(/^\/opportunities\/([0-9a-f-]+)\/apply$/i);
  if (match === null || !opportunityIdPattern.test(match[1])) return null;
  return `/opportunities/${match[1]}/apply`;
}
