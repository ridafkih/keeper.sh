import { activeTraceFields, withLoggedText } from "@keeper.sh/otelemetry/tracing";
import { widelogger, widelog as wideEvent } from "widelogger";
import { buildIdentity } from "../build-identity";

const { context: wideEventContext, destroy } = widelogger({
  service: "keeper-mcp",
  defaultEventName: "wide_event",
  commitHash: buildIdentity.COMMIT_SHA,
  environment: buildIdentity.ENV,
  version: buildIdentity.VERSION,
});

const widelog = withLoggedText(wideEvent);

const context = <Result>(callback: () => Result): Result =>
  wideEventContext(() => {
    widelog.setFields(activeTraceFields()).sticky();
    return callback();
  });

export { context, destroy, widelog };
