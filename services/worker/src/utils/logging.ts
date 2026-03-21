import { widelogger, widelog } from "widelogger";

const { context, destroy } = widelogger({
  service: "keeper-worker",
  defaultEventName: "wide_event",
  commitHash: process.env.COMMIT_SHA,
  environment: process.env.ENV ?? "production",
  version: process.env.npm_package_version,
});

export { context, destroy, widelog };
