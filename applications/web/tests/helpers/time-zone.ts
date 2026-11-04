import { afterAll, beforeAll } from "vitest";

export const runInTimeZone = (timeZone: string): void => {
  const original = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  beforeAll(() => {
    process.env.TZ = timeZone;
  });
  afterAll(() => {
    process.env.TZ = original;
  });
};
