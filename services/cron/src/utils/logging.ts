import { type } from "entrykit";
import { widelogger, widelog } from "widelogger";

const buildIdentity = type({
  COMMIT_SHA: "string > 0",
  VERSION: "string > 0",
  ENV: "'development' | 'production' | 'test'",
}).assert(process.env);

const { context, destroy } = widelogger({
  service: "keeper-cron",
  defaultEventName: "wide_event",
  commitHash: buildIdentity.COMMIT_SHA,
  environment: buildIdentity.ENV,
  version: buildIdentity.VERSION,
});

export { context, destroy, widelog };
