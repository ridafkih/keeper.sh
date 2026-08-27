import { Polar } from "@polar-sh/sdk";
import { afterEach, describe, expect, it } from "vitest";
import {
  deletePolarCustomerByExternalId,
  POLAR_CUSTOMER_DELETE_TIMEOUT_MS,
} from "../src/polar-customer-delete";

const ABORT_OBSERVATION_MS = 4000;
const ABORT_POLL_INTERVAL_MS = 25;
const HUNG_REQUEST_TEST_TIMEOUT_MS = 30_000;

const startHangingPolarServer = (aborts: string[]) =>
  Bun.serve({
    idleTimeout: 0,
    port: 0,
    fetch: (request) => {
      request.signal.addEventListener(
        "abort",
        () => {
          aborts.push(new URL(request.url).pathname);
        },
        { once: true },
      );
      return new Promise<Response>(() => {});
    },
  });

const waitForAbort = async (aborts: string[], waitMs: number) => {
  const deadline = Date.now() + waitMs;
  while (aborts.length === 0 && Date.now() < deadline) {
    await Bun.sleep(ABORT_POLL_INTERVAL_MS);
  }
  return aborts;
};

describe("deletePolarCustomerByExternalId against a hung Polar", () => {
  const servers: ReturnType<typeof startHangingPolarServer>[] = [];

  afterEach(async () => {
    for (const server of servers) {
      await server.stop(true);
    }
    servers.length = 0;
  });

  it(
    "aborts the outbound request when the deletion deadline is reached",
    async () => {
      const aborts: string[] = [];
      const server = startHangingPolarServer(aborts);
      servers.push(server);

      const polarClient = new Polar({
        accessToken: "polar-test-token",
        serverURL: server.url.origin,
      });

      const started = Date.now();

      await expect(
        deletePolarCustomerByExternalId(polarClient, "user-1"),
      ).rejects.toThrow(`exceeded ${POLAR_CUSTOMER_DELETE_TIMEOUT_MS}ms`);

      expect(Date.now() - started).toBeLessThan(
        POLAR_CUSTOMER_DELETE_TIMEOUT_MS + ABORT_OBSERVATION_MS,
      );

      expect(await waitForAbort(aborts, ABORT_OBSERVATION_MS)).toHaveLength(1);
    },
    HUNG_REQUEST_TEST_TIMEOUT_MS,
  );
});
