import { widelogger } from "widelogger";

const { widelog, destroy: destroyWideLogger } = widelogger({
  service: "keeper-cron",
  defaultEventName: "wide_event",
  commitHash: process.env.COMMIT_SHA,
  environment: process.env.NODE_ENV,
  version: process.env.npm_package_version,
});

export { widelog, destroyWideLogger };
