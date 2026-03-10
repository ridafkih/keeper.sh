import { type } from "arktype";

const proxyableMethods = type("'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD' | 'OPTIONS'");

type ProxyableMethods = typeof proxyableMethods.infer;

const planSchema = type("'free' | 'pro'");
type Plan = typeof planSchema.infer;

const billingPeriodSchema = type("'monthly' | 'yearly'");
type BillingPeriod = typeof billingPeriodSchema.infer;

const feedbackRequestSchema = type({
  message: "string",
  type: "'feedback' | 'report'",
  "wantsFollowUp?": "boolean",
  "+": "reject",
});
type FeedbackRequest = typeof feedbackRequestSchema.infer;

const createSourceSchema = type({
  name: "string",
  url: "string",
  "+": "reject",
});

type CreateSource = typeof createSourceSchema.infer;

const stringSchema = type("string");

const googleEventSchema = type({
  "description?": "string",
  "end?": { "dateTime?": "string", "timeZone?": "string" },
  "eventType?": "'default' | 'focusTime' | 'workingLocation' | 'outOfOffice'",
  "iCalUID?": "string",
  "id?": "string",
  "location?": "string",
  "recurrence?": "string[]",
  "start?": { "dateTime?": "string", "timeZone?": "string" },
  "status?": "'confirmed' | 'tentative' | 'cancelled'",
  "summary?": "string",
});
type GoogleEvent = typeof googleEventSchema.infer;

const googleEventListSchema = type({
  "items?": googleEventSchema.array(),
  "nextPageToken?": "string",
  "nextSyncToken?": "string",
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
  "@removed?": { "reason?": "'deleted' | 'changed'" },
  "body?": type({ "content?": "string", "contentType?": "string" }).or(type("null")),
  "categories?": "string[]",
  "end?": { "dateTime?": "string", "timeZone?": "string" },
  "iCalUId?": "string",
  "id?": "string",
  "location?": { "displayName?": "string" },
  "start?": { "dateTime?": "string", "timeZone?": "string" },
  "subject?": "string",
});
type OutlookEvent = typeof outlookEventSchema.infer;

const outlookEventListSchema = type({
  "@odata.deltaLink?": "string",
  "@odata.nextLink?": "string",
  "value?": outlookEventSchema.array(),
});
type OutlookEventList = typeof outlookEventListSchema.infer;

const microsoftApiErrorSchema = type({
  "error?": { "code?": "string", "message?": "string" },
});
type MicrosoftApiError = typeof microsoftApiErrorSchema.infer;

const authSocialProvidersSchema = type({
  google: "boolean",
  microsoft: "boolean",
  "+": "reject",
});
type AuthSocialProviders = typeof authSocialProvidersSchema.infer;

const authCapabilitiesSchema = type({
  commercialMode: "boolean",
  credentialMode: "'email' | 'username'",
  requiresEmailVerification: "boolean",
  socialProviders: authSocialProvidersSchema,
  supportsChangePassword: "boolean",
  supportsPasskeys: "boolean",
  supportsPasswordReset: "boolean",
  "+": "reject",
});
type AuthCapabilities = typeof authCapabilitiesSchema.infer;

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
  "error?": "string",
  inSync: "boolean",
  "lastOperation?": syncOperationSchema,
  "lastSyncedAt?": "string",
  localEventCount: "number",
  "needsReauthentication?": "boolean",
  "progress?": { current: "number", total: "number" },
  remoteEventCount: "number",
  "stage?": "'fetching' | 'comparing' | 'processing' | 'error'",
  status: "'idle' | 'syncing' | 'error'",
});
type SyncStatus = typeof syncStatusSchema.infer;

const syncAggregateSchema = type({
  progressPercent: "number",
  seq: "number",
  syncEventsProcessed: "number",
  syncEventsRemaining: "number",
  syncEventsTotal: "number",
  syncing: "boolean",
  "lastSyncedAt?": "string | null",
});
type SyncAggregate = typeof syncAggregateSchema.infer;

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
  "+": "reject",
});
type SignUpBody = typeof signUpBodySchema.infer;

const caldavDiscoverRequestSchema = type({
  password: "string",
  serverUrl: "string",
  username: "string",
  "+": "reject",
});
type CalDAVDiscoverRequest = typeof caldavDiscoverRequestSchema.infer;

const caldavConnectRequestSchema = type({
  calendarUrl: "string",
  password: "string",
  "provider?": "string",
  serverUrl: "string",
  username: "string",
  "+": "reject",
});
type CalDAVConnectRequest = typeof caldavConnectRequestSchema.infer;

const updateSourceDestinationsSchema = type({
  destinationIds: "string[]",
  "+": "reject",
});
type UpdateSourceDestinations = typeof updateSourceDestinationsSchema.infer;

const checkoutSuccessEventSchema = type({
  "currency?": "string",
  "id?": "string",
  "totalAmount?": "number",
});
type CheckoutSuccessEvent = typeof checkoutSuccessEventSchema.infer;

const googleCalendarListEntrySchema = type({
  accessRole: "'freeBusyReader' | 'reader' | 'writer' | 'owner'",
  "backgroundColor?": "string",
  "description?": "string",
  "foregroundColor?": "string",
  id: "string",
  "primary?": "boolean",
  summary: "string",
});
type GoogleCalendarListEntry = typeof googleCalendarListEntrySchema.infer;

const googleCalendarListResponseSchema = type({
  items: googleCalendarListEntrySchema.array(),
  kind: "'calendar#calendarList'",
  "nextPageToken?": "string",
});
type GoogleCalendarListResponse = typeof googleCalendarListResponseSchema.infer;

const createOAuthSourceSchema = type({
  "destinationId?": "string",
  externalCalendarId: "string",
  name: "string",
  "oauthSourceCredentialId?": "string",
  "syncFocusTime?": "boolean",
  "syncOutOfOffice?": "boolean",
  "syncWorkingLocation?": "boolean",
  "+": "reject",
});
type CreateOAuthSource = typeof createOAuthSourceSchema.infer;

const createCalDAVSourceSchema = type({
  calendarUrl: "string",
  name: "string",
  password: "string",
  provider: "'caldav' | 'fastmail' | 'icloud'",
  serverUrl: "string",
  username: "string",
  "+": "reject",
});
type CreateCalDAVSource = typeof createCalDAVSourceSchema.infer;

const caldavDiscoverSourceSchema = type({
  password: "string",
  serverUrl: "string",
  username: "string",
  "+": "reject",
});
type CalDAVDiscoverSource = typeof caldavDiscoverSourceSchema.infer;

const oauthCalendarSourceSchema = type({
  createdAt: "string",
  destinationId: "string",
  email: "string | null",
  externalCalendarId: "string",
  id: "string",
  name: "string",
  provider: "string",
});
type OAuthCalendarSource = typeof oauthCalendarSourceSchema.infer;

const updateOAuthSourceDestinationsSchema = type({
  destinationIds: "string[]",
  "+": "reject",
});
type UpdateOAuthSourceDestinations = typeof updateOAuthSourceDestinationsSchema.infer;

export {
  proxyableMethods,
  planSchema,
  billingPeriodSchema,
  feedbackRequestSchema,
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
  authSocialProvidersSchema,
  authCapabilitiesSchema,
  socketMessageSchema,
  syncOperationSchema,
  syncStatusSchema,
  syncAggregateSchema,
  broadcastMessageSchema,
  userSchema,
  signUpBodySchema,
  caldavDiscoverRequestSchema,
  caldavConnectRequestSchema,
  updateSourceDestinationsSchema,
  checkoutSuccessEventSchema,
  googleCalendarListEntrySchema,
  googleCalendarListResponseSchema,
  createOAuthSourceSchema,
  createCalDAVSourceSchema,
  caldavDiscoverSourceSchema,
  oauthCalendarSourceSchema,
  updateOAuthSourceDestinationsSchema,
};

export type {
  ProxyableMethods,
  Plan,
  BillingPeriod,
  FeedbackRequest,
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
  AuthSocialProviders,
  AuthCapabilities,
  SocketMessage,
  SyncOperation,
  SyncStatus,
  SyncAggregate,
  BroadcastMessage,
  User,
  SignUpBody,
  CalDAVDiscoverRequest,
  CalDAVConnectRequest,
  UpdateSourceDestinations,
  CheckoutSuccessEvent,
  GoogleCalendarListEntry,
  GoogleCalendarListResponse,
  CreateOAuthSource,
  CreateCalDAVSource,
  CalDAVDiscoverSource,
  OAuthCalendarSource,
  UpdateOAuthSourceDestinations,
};
