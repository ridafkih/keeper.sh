import { widelog, widelogger } from "widelogger";

const { context: runMcpWideEventContext, destroy: destroyWideLogger } = widelogger({
  service: "keeper-mcp",
  defaultEventName: "wide_event",
  commitHash: process.env.COMMIT_SHA,
  environment: process.env.ENV ?? "production",
  version: process.env.npm_package_version,
});

const setWideEventFields = (fields: Record<string, unknown>): void => {
  widelog.setFields(fields);
};

const trackStatusError = (status: number, errorType: string): void => {
  const statusMessage = `HTTP ${status}`;
  widelog.count("error.count");
  if (errorType === "AuthError") {
    widelog.count("error.auth.count");
  } else if (errorType === "HttpError") {
    widelog.count("error.http.count");
  } else {
    widelog.count("error.unknown.count");
  }
  widelog.append("error.types", errorType);
  widelog.set("error.message", statusMessage);
  widelog.set("error.occurred", true);
  widelog.set("error.type", errorType);
};

export {
  destroyWideLogger,
  runMcpWideEventContext,
  setWideEventFields,
  trackStatusError,
  widelog,
};
