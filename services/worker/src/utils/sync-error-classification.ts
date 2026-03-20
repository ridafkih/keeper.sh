const classifySyncError = (error: unknown): string => {
  let rawMessage = "";
  if (typeof error === "string") {
    rawMessage = error;
  }
  if (error instanceof Error) {
    rawMessage = error.message;
  }
  const message = rawMessage.toLowerCase();

  if (message.includes("conflict") || message.includes("409")) {
    return "sync-push-conflict";
  }
  if (message.includes("timeout")) {
    return "provider-api-timeout";
  }
  if (message.includes("rate") || message.includes("429")) {
    return "provider-rate-limited";
  }
  return "sync-push-failed";
};

export { classifySyncError };
