import { widelog, widelogger } from "widelogger";

const { context: runCronWideEventContext, destroy: destroyWideLogger } = widelogger({
  service: "keeper-cron",
  defaultEventName: "wide_event",
  commitHash: process.env.COMMIT_SHA,
  environment: process.env.ENV ?? process.env.NODE_ENV,
  version: process.env.npm_package_version,
});

export { widelog, runCronWideEventContext, destroyWideLogger };
