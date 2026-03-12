import {
  emitWideEvent,
  endTiming,
  getCurrentRequestId,
  incrementLogCount,
  initializeWideLogger,
  reportError,
  runWideEvent,
  setLogFields,
  shutdownLogging,
  startTiming,
} from "@keeper.sh/provider-core";

initializeWideLogger({
  service: process.env.SERVICE_NAME ?? process.env.npm_package_name ?? "keeper-mcp",
});

const trackStatusError = (status: number, errorType: string): void => {
  const statusMessage = `HTTP ${status}`;
  incrementLogCount("error.count");
  incrementLogCount(`error.${errorType}.count`);
  setLogFields({
    [`error.${errorType}.messages`]: [statusMessage],
    "error.message": statusMessage,
    "error.occurred": true,
    "error.type": errorType,
  });
};

export {
  emitWideEvent,
  endTiming,
  getCurrentRequestId,
  incrementLogCount,
  reportError,
  runWideEvent,
  setLogFields,
  shutdownLogging,
  startTiming,
  trackStatusError,
};
