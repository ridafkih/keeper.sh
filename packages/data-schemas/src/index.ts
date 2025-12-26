import { type } from "arktype";

export const proxyableMethods = type(
  "'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD'",
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
  "error?": { "message?": "string", "code?": "number" },
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
  provider: "string",
  status: "'idle' | 'syncing'",
  "stage?": "'fetching' | 'comparing' | 'processing'",
  localEventCount: "number",
  remoteEventCount: "number",
  "progress?": { current: "number", total: "number" },
  "lastOperation?": syncOperationSchema,
  "lastSyncedAt?": "string",
  inSync: "boolean",
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
});
export type User = typeof userSchema.infer;

export const signUpBodySchema = type({
  email: "string",
  "name?": "string",
  "password?": "string",
});
export type SignUpBody = typeof signUpBodySchema.infer;
