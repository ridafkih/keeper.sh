import { activeTraceFields } from "@keeper.sh/otelemetry/tracing";
import { type } from "entrykit";
import { widelogger, widelog } from "widelogger";

const buildIdentity = type({
  COMMIT_SHA: "string > 0",
  VERSION: "string > 0",
  ENV: "'development' | 'production' | 'test'",
}).assert(process.env);

const { context: wideEventContext, destroy } = widelogger({
  service: "keeper-cron",
  defaultEventName: "wide_event",
  commitHash: buildIdentity.COMMIT_SHA,
  environment: buildIdentity.ENV,
  version: buildIdentity.VERSION,
});

const context = <Result>(callback: () => Result): Result =>
  wideEventContext(() => {
    widelog.setFields(activeTraceFields()).sticky();
    return callback();
  });

export { context, destroy, widelog };
