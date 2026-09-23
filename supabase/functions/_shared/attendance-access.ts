export function attendanceAccessToken(
  hasApplicantCapability: boolean,
  bearerToken: string | undefined,
  platformAnonToken: string | undefined,
): string | undefined {
  return hasApplicantCapability || bearerToken === platformAnonToken
    ? undefined
    : bearerToken;
}
