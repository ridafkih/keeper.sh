import { Polar } from "@polar-sh/sdk";
import { HTTPClient } from "@polar-sh/sdk/lib/http.js";
import { describe, expect, it } from "vitest";
import {
  deletePolarCustomerByExternalId,
  POLAR_CUSTOMER_DELETE_TIMEOUT_MS,
} from "../src/polar-customer-delete";
import { createSilentProviderFetch } from "./support/silent-provider-fetch";

const ABORT_OBSERVATION_MS = 4000;
const ABORT_POLL_INTERVAL_MS = 25;
const HUNG_REQUEST_TEST_TIMEOUT_MS = 30_000;
const SILENT_POLAR_ORIGIN = "https://polar.invalid";

const silentPolarClient = (aborts: string[]) =>
  new Polar({
    accessToken: "polar-test-token",
    serverURL: SILENT_POLAR_ORIGIN,
    httpClient: new HTTPClient({
      fetcher: createSilentProviderFetch({
        onRequest: (request) => {
          request.signal.addEventListener(
            "abort",
            () => {
              aborts.push(new URL(request.url).pathname);
            },
            { once: true },
          );
        },
      }),
    }),
  });

const waitForAbort = async (aborts: string[], waitMs: number) => {
  const deadline = Date.now() + waitMs;
  while (aborts.length === 0 && Date.now() < deadline) {
    await Bun.sleep(ABORT_POLL_INTERVAL_MS);
  }
  return aborts;
};

describe("deletePolarCustomerByExternalId against a hung Polar", () => {
  it(
    "aborts the outbound request when the deletion deadline is reached",
    async () => {
      const aborts: string[] = [];
      const polarClient = silentPolarClient(aborts);

      const started = Date.now();

      await expect(
        deletePolarCustomerByExternalId(polarClient, "user-1"),
      ).rejects.toThrow(`exceeded ${POLAR_CUSTOMER_DELETE_TIMEOUT_MS}ms`);

      expect(Date.now() - started).toBeLessThan(
        POLAR_CUSTOMER_DELETE_TIMEOUT_MS + ABORT_OBSERVATION_MS,
      );

      expect(await waitForAbort(aborts, ABORT_OBSERVATION_MS)).toEqual([
        "/v1/customers/external/user-1",
      ]);
    },
    HUNG_REQUEST_TEST_TIMEOUT_MS,
  );
});
