export function isAtLeast19(birthDate: string, currentDate: Date): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (match === null) return false;

  const birthYear = Number(match[1]);
  const birthMonth = Number(match[2]);
  const birthDay = Number(match[3]);
  const parsedBirthDate = new Date(
    Date.UTC(birthYear, birthMonth - 1, birthDay),
  );
  if (
    parsedBirthDate.getUTCFullYear() !== birthYear ||
    parsedBirthDate.getUTCMonth() !== birthMonth - 1 ||
    parsedBirthDate.getUTCDate() !== birthDay
  )
    return false;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(currentDate);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  let age = Number(values.get("year")) - birthYear;
  if (
    Number(values.get("month")) < birthMonth ||
    (Number(values.get("month")) === birthMonth &&
      Number(values.get("day")) < birthDay)
  )
    age -= 1;
  return age >= 19;
}
