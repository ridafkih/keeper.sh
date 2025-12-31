import { type } from "arktype";

export const proxyableMethods = type(
  "'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD' | 'OPTIONS'",
);

export type ProxyableMethods = typeof proxyableMethods.infer;

export const planSchema = type("'free' | 'pro'");
export type Plan = typeof planSchema.infer;

export const billingPeriodSchema = type("'monthly' | 'yearly'");
export type BillingPeriod = typeof billingPeriodSchema.infer;

export const createSourceSchema = type({
  name: "string",
  url: "string",
});

export type CreateSource = typeof createSourceSchema.infer;

export const stringSchema = type("string");

export const googleEventSchema = type({
  "id?": "string",
  "iCalUID?": "string",
  "summary?": "string",
  "description?": "string",
  "start?": { "dateTime?": "string", "timeZone?": "string" },
  "end?": { "dateTime?": "string", "timeZone?": "string" },
});
export type GoogleEvent = typeof googleEventSchema.infer;

export const googleEventListSchema = type({
  "items?": googleEventSchema.array(),
  "nextPageToken?": "string",
});
export type GoogleEventList = typeof googleEventListSchema.infer;

export const googleApiErrorSchema = type({
  "error?": { "message?": "string", "code?": "number", "status?": "string" },
});
export type GoogleApiError = typeof googleApiErrorSchema.infer;

export const googleTokenResponseSchema = type({
  access_token: "string",
  expires_in: "number",
  "refresh_token?": "string",
  scope: "string",
  token_type: "string",
});
export type GoogleTokenResponse = typeof googleTokenResponseSchema.infer;

export const googleUserInfoSchema = type({
  id: "string",
  email: "string",
  "verified_email?": "boolean",
  "name?": "string",
  "given_name?": "string",
  "family_name?": "string",
  "picture?": "string",
});
export type GoogleUserInfo = typeof googleUserInfoSchema.infer;

export const microsoftTokenResponseSchema = type({
  access_token: "string",
  token_type: "string",
  expires_in: "number",
  "refresh_token?": "string",
  scope: "string",
});
export type MicrosoftTokenResponse = typeof microsoftTokenResponseSchema.infer;

export const microsoftUserInfoSchema = type({
  id: "string",
  "mail?": "string",
  "userPrincipalName?": "string",
  "displayName?": "string",
});
export type MicrosoftUserInfo = typeof microsoftUserInfoSchema.infer;

export const outlookEventSchema = type({
  "id?": "string",
  "iCalUId?": "string",
  "subject?": "string",
  "body?": { "contentType?": "string", "content?": "string" },
  "start?": { "dateTime?": "string", "timeZone?": "string" },
  "end?": { "dateTime?": "string", "timeZone?": "string" },
  "categories?": "string[]",
});
export type OutlookEvent = typeof outlookEventSchema.infer;

export const outlookEventListSchema = type({
  "value?": outlookEventSchema.array(),
  "@odata.nextLink?": "string",
});
export type OutlookEventList = typeof outlookEventListSchema.infer;

export const microsoftApiErrorSchema = type({
  "error?": { "code?": "string", "message?": "string" },
});
export type MicrosoftApiError = typeof microsoftApiErrorSchema.infer;

export const socketMessageSchema = type({
  event: "string",
  "data?": "unknown",
});
export type SocketMessage = typeof socketMessageSchema.infer;

export const syncOperationSchema = type({
  type: "'add' | 'remove'",
  eventTime: "string",
});
export type SyncOperation = typeof syncOperationSchema.infer;

export const syncStatusSchema = type({
  destinationId: "string",
  status: "'idle' | 'syncing'",
  "stage?": "'fetching' | 'comparing' | 'processing'",
  localEventCount: "number",
  remoteEventCount: "number",
  "progress?": { current: "number", total: "number" },
  "lastOperation?": syncOperationSchema,
  "lastSyncedAt?": "string",
  inSync: "boolean",
  "needsReauthentication?": "boolean",
});
export type SyncStatus = typeof syncStatusSchema.infer;

export const broadcastMessageSchema = type({
  userId: "string",
  event: "string",
  data: "unknown",
});
export type BroadcastMessage = typeof broadcastMessageSchema.infer;

export const userSchema = type({
  id: "string",
  "username?": "string",
  "name?": "string",
  "email?": "string",
  "emailVerified?": "boolean",
});
export type User = typeof userSchema.infer;

export const signUpBodySchema = type({
  email: "string",
  "name?": "string",
  "password?": "string",
});
export type SignUpBody = typeof signUpBodySchema.infer;

export const caldavDiscoverRequestSchema = type({
  serverUrl: "string",
  username: "string",
  password: "string",
});
export type CalDAVDiscoverRequest = typeof caldavDiscoverRequestSchema.infer;

export const caldavConnectRequestSchema = type({
  serverUrl: "string",
  username: "string",
  password: "string",
  calendarUrl: "string",
  "provider?": "string",
});
export type CalDAVConnectRequest = typeof caldavConnectRequestSchema.infer;

export const updateSourceDestinationsSchema = type({
  destinationIds: "string[]",
});
export type UpdateSourceDestinations = typeof updateSourceDestinationsSchema.infer;
