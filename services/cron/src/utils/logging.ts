import { widelogger, widelog } from "widelogger";

const environment = process.env.ENV ?? "production";

const { context, destroy } = widelogger({
  service: "keeper-cron",
  defaultEventName: "wide_event",
  commitHash: process.env.COMMIT_SHA,
  environment,
  version: process.env.npm_package_version,
});

export { context, destroy, widelog };
