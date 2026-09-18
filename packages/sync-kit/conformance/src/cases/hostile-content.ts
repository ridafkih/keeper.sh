import type { Capabilities, ProviderId } from "@keeper.sh/sync-protocol";
import type { ConformanceCase } from "../registry/case";
import {
  caseScope,
  defineCase,
  failureKindOf,
  foreignEvent,
  insist,
  listChanges,
  listingOf,
  markedWith,
  seedWith,
  uidsOf,
} from "./support";

const hostileTitles = [
  "rate limit exceeded",
  "410 Gone",
  "Precondition Failed",
  "HTTP 429 Too Many Requests",
  "fullSyncRequired",
  "\u0000 NUL byte",
];

const hostileContentCases = <Provider extends ProviderId>(
  supports: Capabilities<Provider>,
): readonly ConformanceCase<Provider>[] => [
  defineCase(
    supports,
    "CONF-O23",
    "event content cannot change how a failure is classified",
    async (context) => {
      const scope = caseScope(context);
      const seeded = hostileTitles.map((title, index) =>
        foreignEvent(scope.calendar, {
          uid: markedWith("CONF-O23", `hostile\u0000${index}`),
          title,
          start: "2026-03-02T09:00:00.000Z",
          end: "2026-03-02T10:00:00.000Z",
        }),
      );
      await seedWith(context, seeded);

      const listing = listingOf("CONF-O23", await listChanges(context, scope));
      insist(
        "CONF-O23",
        uidsOf(listing).length === seeded.length,
        "hostile titles turned a healthy listing into something else",
      );
      insist(
        "CONF-O23",
        new Set(uidsOf(listing)).size === seeded.length,
        "a NUL byte in a title collapsed two identities into one",
      );

      context.environment.transport.answerWith({
        kind: "reject",
        failure: { kind: "rateLimited", retryAfter: null, scope: supports.quotaScope },
        times: Number.MAX_SAFE_INTEGER,
      });
      const throttled = await listChanges(context, scope);
      context.environment.transport.answerWith({ kind: "pass" });

      insist(
        "CONF-O23",
        failureKindOf(throttled) === "rateLimited",
        "a real throttle was reclassified once customer data was in the payload",
      );
    },
  ),
];

export { hostileContentCases, hostileTitles };
