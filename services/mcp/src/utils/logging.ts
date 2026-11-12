import { activeTraceFields } from "@keeper.sh/otelemetry/tracing";
import { widelogger, widelog } from "widelogger";
import { buildIdentity } from "../build-identity";

const { context: wideEventContext, destroy } = widelogger({
  service: "keeper-mcp",
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
