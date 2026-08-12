import { afterEach, describe, expect, it, vi } from "vitest";
import { checkEncryptionKeyConfigured } from "../src/encryption-key-check";

const NO_KEY: string | undefined = process.env.ENCRYPTION_KEY_DELIBERATELY_UNSET;

const captureExit = (): { written: string[]; exitCodes: number[] } => {
  const written: string[] = [];
  const exitCodes: number[] = [];

  vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
    written.push(String(chunk));
    return true;
  });
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    exitCodes.push(code ?? 0);
  }) as never);

  return { written, exitCodes };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checkEncryptionKeyConfigured", () => {
  it("stays silent when a key is configured", () => {
    const { written, exitCodes } = captureExit();

    checkEncryptionKeyConfigured("some-key");

    expect(written).toEqual([]);
    expect(exitCodes).toEqual([]);
  });

  it("exits with an actionable notice when the key is missing", () => {
    const { written, exitCodes } = captureExit();

    checkEncryptionKeyConfigured(NO_KEY);

    const notice = written.join("");
    expect(exitCodes).toEqual([1]);
    expect(notice).toContain("ENCRYPTION_KEY");
    expect(notice).toContain("openssl rand -base64 32");
    expect(notice).toContain("api, cron");
    expect(notice).toContain("worker");
  });

  it("treats an empty key as missing", () => {
    const { exitCodes } = captureExit();

    checkEncryptionKeyConfigured("");

    expect(exitCodes).toEqual([1]);
  });
});
