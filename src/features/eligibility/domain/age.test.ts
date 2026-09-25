import { isAtLeast19 } from "./age";

it("uses the Seoul birthday boundary for the adult-only rule", () => {
  expect(isAtLeast19("2007-09-23", new Date("2026-09-22T14:59:59.000Z"))).toBe(
    false,
  );
  expect(isAtLeast19("2007-09-23", new Date("2026-09-22T15:00:00.000Z"))).toBe(
    true,
  );
  expect(isAtLeast19("2010-01-01", new Date("2026-09-24T00:00:00.000Z"))).toBe(
    false,
  );
  expect(isAtLeast19("invalid", new Date("2026-09-24T00:00:00.000Z"))).toBe(
    false,
  );
});
