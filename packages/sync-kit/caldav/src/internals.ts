import type { ChangeListing, Result } from "@keeper.sh/sync-protocol";
import type { CalDAVDependencies } from "./dependencies";
import type { AuthScope } from "./client/auth-scope";
import { createAuthScope } from "./client/auth-scope";
import { transportOf } from "./client/dav-client";
import type { CollectionSemaphore } from "./client/semaphore";
import { createCollectionSemaphore } from "./client/semaphore";
import type { SingleFlight } from "./client/single-flight";
import { createSingleFlight } from "./client/single-flight";
import type { Frontier } from "./cursor/frontier";
import { createFrontier } from "./cursor/frontier";
import type { DecisionRecord } from "./decisions";
import { createDecisionRecord } from "./decisions";
import type { ReportedLedger } from "./listing/reported";
import { createReportedLedger } from "./listing/reported";
import type { SupportedReports } from "./report/supported-reports";

interface CalDAVInternals {
  readonly dependencies: CalDAVDependencies;
  readonly permits: CollectionSemaphore;
  readonly flights: SingleFlight<Result<ChangeListing>>;
  readonly authScope: AuthScope;
  readonly frontier: Frontier;
  readonly reportSupport: Map<string, SupportedReports>;
  readonly reported: ReportedLedger;
  readonly decisions: DecisionRecord;
  readonly transport: typeof fetch;
}

const createCalDAVInternals = (dependencies: CalDAVDependencies): CalDAVInternals => ({
  dependencies,
  permits: createCollectionSemaphore(dependencies.collectionConcurrency),
  flights: createSingleFlight<Result<ChangeListing>>(),
  authScope: createAuthScope(),
  frontier: createFrontier(),
  reportSupport: new Map<string, SupportedReports>(),
  reported: createReportedLedger(),
  decisions: createDecisionRecord(),
  transport: transportOf(dependencies.client),
});

export { createCalDAVInternals };
export type { CalDAVInternals };
