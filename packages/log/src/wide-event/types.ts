interface BaseWideEventFields {
  "request.id": string;
  "request.timing.start": number;
  "request.timing.end"?: number;
  "request.duration.ms"?: number;

  "operation.type"?: string;
  "operation.name"?: string;

  "error.occurred"?: boolean;
  "error.count"?: number;

  timings?: Record<string, number>;

  [key: string]: unknown;
}

interface HttpFields {
  "http.method"?: string;
  "http.path"?: string;
  "http.statusCode"?: number;
  "http.userAgent"?: string;
  "http.origin"?: string;
}

interface UserFields {
  "user.id"?: string;
  "user.email"?: string;
  "user.sessionId"?: string;
  "user.subscriptionPlan"?: "free" | "pro";
  "user.sourceCount"?: number;
  "user.destinationCount"?: number;
  "user.accountAgeDays"?: number;
}

interface SyncFields {
  "sync.sourceId"?: string;
  "sync.destinationId"?: string;
  "sync.provider"?: string;
  "sync.parentRequestId"?: string;
  "sync.generation"?: number;
  "sync.eventsAdded"?: number;
  "sync.eventsRemoved"?: number;
  "sync.localEventCount"?: number;
  "sync.remoteEventCount"?: number;
}

interface JobFields {
  "job.name"?: string;
  "job.type"?: string;
  "job.processedCount"?: number;
  "job.failedCount"?: number;
}

interface ApiWideEventFields extends BaseWideEventFields, HttpFields, UserFields, SyncFields {}

interface CronWideEventFields extends BaseWideEventFields, JobFields, SyncFields {}

interface WebSocketWideEventFields extends BaseWideEventFields, UserFields {}

interface SyncWideEventFields extends BaseWideEventFields, SyncFields, UserFields {}

export type {
  ApiWideEventFields,
  BaseWideEventFields,
  CronWideEventFields,
  SyncWideEventFields,
  WebSocketWideEventFields,
};
