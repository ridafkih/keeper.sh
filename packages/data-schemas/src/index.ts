import { type } from "arktype";

const proxyableMethods = type("'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD' | 'OPTIONS'");

type ProxyableMethods = typeof proxyableMethods.infer;

const planSchema = type("'free' | 'pro'");
type Plan = typeof planSchema.infer;

const billingPeriodSchema = type("'monthly' | 'yearly'");
type BillingPeriod = typeof billingPeriodSchema.infer;

const createSourceSchema = type({
  name: "string",
  url: "string",
});

type CreateSource = typeof createSourceSchema.infer;

const stringSchema = type("string");

const googleEventSchema = type({
  "description?": "string",
  "end?": { "dateTime?": "string", "timeZone?": "string" },
  "iCalUID?": "string",
  "id?": "string",
  "start?": { "dateTime?": "string", "timeZone?": "string" },
  "summary?": "string",
});
type GoogleEvent = typeof googleEventSchema.infer;

const googleEventListSchema = type({
  "items?": googleEventSchema.array(),
  "nextPageToken?": "string",
});
type GoogleEventList = typeof googleEventListSchema.infer;

const googleApiErrorSchema = type({
  "error?": { "code?": "number", "message?": "string", "status?": "string" },
});
type GoogleApiError = typeof googleApiErrorSchema.infer;

const googleTokenResponseSchema = type({
  access_token: "string",
  expires_in: "number",
  "refresh_token?": "string",
  scope: "string",
  token_type: "string",
});
type GoogleTokenResponse = typeof googleTokenResponseSchema.infer;

const googleUserInfoSchema = type({
  email: "string",
  "family_name?": "string",
  "given_name?": "string",
  id: "string",
  "name?": "string",
  "picture?": "string",
  "verified_email?": "boolean",
});
type GoogleUserInfo = typeof googleUserInfoSchema.infer;

const microsoftTokenResponseSchema = type({
  access_token: "string",
  expires_in: "number",
  "refresh_token?": "string",
  scope: "string",
  token_type: "string",
});
type MicrosoftTokenResponse = typeof microsoftTokenResponseSchema.infer;

const microsoftUserInfoSchema = type({
  "displayName?": "string",
  id: "string",
  "mail?": "string",
  "userPrincipalName?": "string",
});
type MicrosoftUserInfo = typeof microsoftUserInfoSchema.infer;

const outlookEventSchema = type({
  "body": type({ "content?": "string", "contentType?": "string" }).or(type('null')),
  "categories?": "string[]",
  "end?": { "dateTime?": "string", "timeZone?": "string" },
  "iCalUId?": "string",
  "id?": "string",
  "start?": { "dateTime?": "string", "timeZone?": "string" },
  "subject?": "string",
});
type OutlookEvent = typeof outlookEventSchema.infer;

const outlookEventListSchema = type({
  "@odata.nextLink?": "string",
  "value?": outlookEventSchema.array(),
});
type OutlookEventList = typeof outlookEventListSchema.infer;

const microsoftApiErrorSchema = type({
  "error?": { "code?": "string", "message?": "string" },
});
type MicrosoftApiError = typeof microsoftApiErrorSchema.infer;

const socketMessageSchema = type({
  "data?": "unknown",
  event: "string",
});
type SocketMessage = typeof socketMessageSchema.infer;

const syncOperationSchema = type({
  eventTime: "string",
  type: "'add' | 'remove'",
});
type SyncOperation = typeof syncOperationSchema.infer;

const syncStatusSchema = type({
  destinationId: "string",
  inSync: "boolean",
  "lastOperation?": syncOperationSchema,
  "lastSyncedAt?": "string",
  localEventCount: "number",
  "needsReauthentication?": "boolean",
  "progress?": { current: "number", total: "number" },
  remoteEventCount: "number",
  "stage?": "'fetching' | 'comparing' | 'processing'",
  status: "'idle' | 'syncing'",
});
type SyncStatus = typeof syncStatusSchema.infer;

const broadcastMessageSchema = type({
  data: "unknown",
  event: "string",
  userId: "string",
});
type BroadcastMessage = typeof broadcastMessageSchema.infer;

const userSchema = type({
  "email?": "string",
  "emailVerified?": "boolean",
  id: "string",
  "name?": "string",
  "username?": "string",
});
type User = typeof userSchema.infer;

const signUpBodySchema = type({
  email: "string",
  "name?": "string",
  "password?": "string",
});
type SignUpBody = typeof signUpBodySchema.infer;

const caldavDiscoverRequestSchema = type({
  password: "string",
  serverUrl: "string",
  username: "string",
});
type CalDAVDiscoverRequest = typeof caldavDiscoverRequestSchema.infer;

const caldavConnectRequestSchema = type({
  calendarUrl: "string",
  password: "string",
  "provider?": "string",
  serverUrl: "string",
  username: "string",
});
type CalDAVConnectRequest = typeof caldavConnectRequestSchema.infer;

const updateSourceDestinationsSchema = type({
  destinationIds: "string[]",
});
type UpdateSourceDestinations = typeof updateSourceDestinationsSchema.infer;

const checkoutSuccessEventSchema = type({
  "currency?": "string",
  "id?": "string",
  "totalAmount?": "number",
});
type CheckoutSuccessEvent = typeof checkoutSuccessEventSchema.infer;

export {
  proxyableMethods,
  planSchema,
  billingPeriodSchema,
  createSourceSchema,
  stringSchema,
  googleEventSchema,
  googleEventListSchema,
  googleApiErrorSchema,
  googleTokenResponseSchema,
  googleUserInfoSchema,
  microsoftTokenResponseSchema,
  microsoftUserInfoSchema,
  outlookEventSchema,
  outlookEventListSchema,
  microsoftApiErrorSchema,
  socketMessageSchema,
  syncOperationSchema,
  syncStatusSchema,
  broadcastMessageSchema,
  userSchema,
  signUpBodySchema,
  caldavDiscoverRequestSchema,
  caldavConnectRequestSchema,
  updateSourceDestinationsSchema,
  checkoutSuccessEventSchema,
};

export type {
  ProxyableMethods,
  Plan,
  BillingPeriod,
  CreateSource,
  GoogleEvent,
  GoogleEventList,
  GoogleApiError,
  GoogleTokenResponse,
  GoogleUserInfo,
  MicrosoftTokenResponse,
  MicrosoftUserInfo,
  OutlookEvent,
  OutlookEventList,
  MicrosoftApiError,
  SocketMessage,
  SyncOperation,
  SyncStatus,
  BroadcastMessage,
  User,
  SignUpBody,
  CalDAVDiscoverRequest,
  CalDAVConnectRequest,
  UpdateSourceDestinations,
  CheckoutSuccessEvent,
};
