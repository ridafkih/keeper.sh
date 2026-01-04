export type ServiceBoundary = "api" | "cron" | "sync" | "websocket" | "web";

export interface WideEventFields {
  requestId: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  serviceBoundary: ServiceBoundary;

  operationType?: string;
  operationName?: string;

  httpMethod?: string;
  httpPath?: string;
  httpStatusCode?: number;
  httpUserAgent?: string;
  httpOrigin?: string;

  userId?: string;
  userEmail?: string;
  sessionId?: string;

  subscriptionPlan?: "free" | "pro";
  sourceCount?: number;
  destinationCount?: number;

  sourceId?: string;
  destinationId?: string;
  provider?: string;

  syncGeneration?: number;
  eventsAdded?: number;
  eventsRemoved?: number;
  localEventCount?: number;
  remoteEventCount?: number;

  jobName?: string;
  processedCount?: number;
  failedCount?: number;

  error?: boolean;
  errorType?: string;
  errorMessage?: string;
  errorCode?: string;

  timings?: Record<string, number>;

  [key: string]: unknown;
}

export type WideEventEmitFunction = (event: WideEventFields) => void;
