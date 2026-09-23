import type { Capabilities, ProviderId } from "@keeper.sh/sync-protocol";
import type { ConformanceCase } from "../registry/case";
import {
  caseScope,
  defineCase,
  foreignEvent,
  insist,
  listChanges,
  markedWith,
  seedWith,
} from "./support";

const injectionCases = <Provider extends ProviderId>(
  supports: Capabilities<Provider>,
): readonly ConformanceCase<Provider>[] => [
  defineCase(
    supports,
    "CONF-L13",
    "the injected clock and transport were the ones the adapter actually used",
    async (context) => {
      const scope = caseScope(context);
      await seedWith(context, [
        foreignEvent(scope.calendar, {
          uid: markedWith("CONF-L13", "alpha"),
          start: "2026-03-02T09:00:00.000Z",
          end: "2026-03-02T10:00:00.000Z",
        }),
      ]);
      const frozen = context.environment.clock.now();
      const callsBefore = context.environment.transport.callCount();
      const readsBefore = context.environment.clock.nowCount();

      await listChanges(context, scope, null, { now: () => frozen });

      insist(
        "CONF-L13",
        context.environment.transport.callCount() > callsBefore,
        "the adapter answered without ever reaching the injected transport",
      );
      insist(
        "CONF-L13",
        context.environment.clock.nowCount() > readsBefore,
        "the adapter never read the injected clock, so every deadline case below is vacuous",
      );
    },
  ),
];

export { injectionCases };
