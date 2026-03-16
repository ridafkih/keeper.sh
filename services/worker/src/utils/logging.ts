import { widelog, widelogger } from "widelogger";

const { context: runWorkerWideEventContext, destroy: destroyWideLogger } = widelogger({
  service: "keeper-worker",
  defaultEventName: "wide_event",
  commitHash: process.env.COMMIT_SHA,
  environment: process.env.ENV ?? "production",
  version: process.env.npm_package_version,
});

export { widelog, runWorkerWideEventContext, destroyWideLogger };
