import { type } from "arktype";

const sourceAuthorizeQuerySchema = type({
  provider: "string",
  "credentialId?": "string",
  "+": "reject",
});
type SourceAuthorizeQuery = typeof sourceAuthorizeQuerySchema.infer;

const destinationAuthorizeQuerySchema = type({
  provider: "string",
  "destinationId?": "string",
  "+": "reject",
});
type DestinationAuthorizeQuery = typeof destinationAuthorizeQuerySchema.infer;

const callbackStateQuerySchema = type({
  token: "string",
  "+": "reject",
});
type CallbackStateQuery = typeof callbackStateQuerySchema.infer;

const socketQuerySchema = type({
  token: "string",
  "+": "reject",
});
type SocketQuery = typeof socketQuerySchema.infer;

const oauthCallbackQuerySchema = type({
  "code?": "string",
  "state?": "string",
  "error?": "string",
});
type OAuthCallbackQuery = typeof oauthCallbackQuerySchema.infer;

const oauthCalendarListingQuerySchema = type([
  {
    destinationId: "string",
    "credentialId?": "string",
    "+": "reject",
  },
  {
    credentialId: "string",
    "destinationId?": "string",
    "+": "reject",
  },
]);
type OAuthCalendarListingQuery = typeof oauthCalendarListingQuerySchema.infer;

const caldavSourcesQuerySchema = type({
  "provider?": "string",
  "+": "reject",
});
type CaldavSourcesQuery = typeof caldavSourcesQuerySchema.infer;

const providerParamSchema = type({
  provider: "string",
  "+": "reject",
});
type ProviderParam = typeof providerParamSchema.infer;

const idParamSchema = type({
  id: "string",
  "+": "reject",
});
type IdParam = typeof idParamSchema.infer;

export {
  sourceAuthorizeQuerySchema,
  destinationAuthorizeQuerySchema,
  callbackStateQuerySchema,
  socketQuerySchema,
  oauthCallbackQuerySchema,
  oauthCalendarListingQuerySchema,
  caldavSourcesQuerySchema,
  providerParamSchema,
  idParamSchema,
};
export type {
  SourceAuthorizeQuery,
  DestinationAuthorizeQuery,
  CallbackStateQuery,
  SocketQuery,
  OAuthCallbackQuery,
  OAuthCalendarListingQuery,
  CaldavSourcesQuery,
  ProviderParam,
  IdParam,
};
