import { widelog, widelogger } from "widelogger";

const { context: runApiWideEventContext, destroy: destroyWideLogger } = widelogger({
  service: "keeper-api",
  defaultEventName: "wide_event",
  commitHash: process.env.COMMIT_SHA,
  environment: process.env.ENV ?? process.env.NODE_ENV,
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

const respondWithLoggedError = (error: unknown, response: Response): Response => {
  widelog.set("status_code", response.status);
  if (response.status >= 400) {
    widelog.set("outcome", "error");
  } else {
    widelog.set("outcome", "success");
  }
  widelog.errorFields(error);
  return response;
};

export {
  destroyWideLogger,
  respondWithLoggedError,
  runApiWideEventContext,
  setWideEventFields,
  trackStatusError,
  widelog,
};
