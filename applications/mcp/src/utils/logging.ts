import { widelogger } from "widelogger";

const { widelog, destroy: destroyWideLogger } = widelogger({
  service: "keeper-mcp",
  defaultEventName: "wide_event",
  commitHash: process.env.COMMIT_SHA,
  environment: process.env.NODE_ENV,
  version: process.env.npm_package_version,
});

const trackStatusError = (status: number, errorType: string): void => {
  const statusMessage = `HTTP ${status}`;
  widelog.count("error.count");
  widelog.count(`error.${errorType}.count`);
  widelog.set("error.message", statusMessage);
  widelog.set("error.occurred", true);
  widelog.set("error.type", errorType);
};

export {
  destroyWideLogger,
  trackStatusError,
  widelog,
};
