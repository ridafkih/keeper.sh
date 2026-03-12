import type { SyncResult } from "../types";
import type { SyncContext, SyncCoordinator } from "./coordinator";
import { widelogger } from "widelogger";

const { widelog } = widelogger({
  service: "keeper",
  defaultEventName: "wide_event",
  commitHash: process.env.COMMIT_SHA,
  environment: process.env.ENV ?? process.env.NODE_ENV,
  version: process.env.npm_package_version,
});

const INITIAL_ADDED_COUNT = 0;
const INITIAL_ADD_FAILED_COUNT = 0;
const INITIAL_REMOVED_COUNT = 0;
const INITIAL_REMOVE_FAILED_COUNT = 0;

interface DestinationProvider {
  syncForUser(userId: string, context: SyncContext): Promise<SyncResult | null>;
}

interface SyncDestinationsOptions {
  jobName?: string;
  jobType?: string;
}

const syncDestinationsForUser = (
  userId: string,
  providers: DestinationProvider[],
  syncCoordinator: SyncCoordinator,
  options: SyncDestinationsOptions = {},
): Promise<SyncResult> =>
  widelog.context(async () => {
    widelog.set("operation.name", "sync:destinations");
    widelog.set("operation.type", "sync");
    widelog.set("user.id", userId);
    widelog.set("provider.count", providers.length);
    if (options.jobName) {
      widelog.set("job.name", options.jobName);
    }
    if (options.jobType) {
      widelog.set("job.type", options.jobType);
    }
    widelog.time.start("duration_ms");

    const context = await syncCoordinator.startSync(userId);
    context.jobName = options.jobName;
    context.jobType = options.jobType;

    const settledResults = await Promise.allSettled(
      providers.map((provider) =>
        Promise.resolve().then(() => provider.syncForUser(userId, context)),
      ),
    );

    await syncCoordinator.isSyncCurrent(context);

    const combined: SyncResult = {
      addFailed: INITIAL_ADD_FAILED_COUNT,
      added: INITIAL_ADDED_COUNT,
      removeFailed: INITIAL_REMOVE_FAILED_COUNT,
      removed: INITIAL_REMOVED_COUNT,
    };

    let failedProviderCount = 0;

    for (const [providerIndex, settled] of settledResults.entries()) {
      if (settled.status === "rejected") {
        failedProviderCount++;
        widelog.set(`provider.${providerIndex}.error`, true);
        continue;
      }
      if (settled.value === null) {
        continue;
      }
      combined.added += settled.value.added;
      combined.addFailed += settled.value.addFailed;
      combined.removed += settled.value.removed;
      combined.removeFailed += settled.value.removeFailed;
    }

    widelog.set("events.added", combined.added);
    widelog.set("events.add_failed", combined.addFailed);
    widelog.set("events.removed", combined.removed);
    widelog.set("events.remove_failed", combined.removeFailed);
    widelog.set("provider.failed_count", failedProviderCount);
    widelog.time.stop("duration_ms");
    widelog.flush();

    return combined;
  });

export { syncDestinationsForUser };
export type { DestinationProvider };
