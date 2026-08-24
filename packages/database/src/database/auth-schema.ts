import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const user = pgTable("user", {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  id: text().notNull().primaryKey(),
  image: text(),
  name: text().notNull(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  username: text().unique(),
});

const session = pgTable("session", {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  id: text().notNull().primaryKey(),
  ipAddress: text(),
  token: text().notNull().unique(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  userAgent: text(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

const account = pgTable("account", {
  accessToken: text(),
  accessTokenExpiresAt: timestamp({ withTimezone: true }),
  accountId: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  id: text().notNull().primaryKey(),
  idToken: text(),
  password: text(),
  providerId: text().notNull(),
  refreshToken: text(),
  refreshTokenExpiresAt: timestamp({ withTimezone: true }),
  scope: text(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

const verification = pgTable("verification", {
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  id: text().notNull().primaryKey(),
  identifier: text().notNull(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  value: text().notNull(),
});

const passkey = pgTable("passkey", {
  aaguid: text(),
  backedUp: boolean().notNull(),
  counter: integer().notNull(),
  createdAt: timestamp({ withTimezone: true }),
  credentialID: text().notNull(),
  deviceType: text().notNull(),
  id: text().notNull().primaryKey(),
  name: text(),
  publicKey: text().notNull(),
  transports: text(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

const jwks = pgTable("jwks", {
  id: text().notNull().primaryKey(),
  publicKey: text().notNull(),
  privateKey: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp({ withTimezone: true }),
});

const oauthClient = pgTable(
  "oauth_application",
  {
    id: text().notNull().primaryKey(),
    clientId: text().notNull().unique(),
    clientSecret: text(),
    disabled: boolean().notNull().default(false),
    skipConsent: boolean(),
    enableEndSession: boolean(),
    subjectType: text(),
    scopes: text().array(),
    userId: text().references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    expiresAt: timestamp({ withTimezone: true }),
    name: text(),
    uri: text(),
    icon: text(),
    contacts: text().array(),
    tos: text(),
    policy: text(),
    softwareId: text(),
    softwareVersion: text(),
    softwareStatement: text(),
    redirectUris: text().array().notNull(),
    postLogoutRedirectUris: text().array(),
    tokenEndpointAuthMethod: text(),
    grantTypes: text().array(),
    responseTypes: text().array(),
    public: boolean(),
    type: text(),
    requirePKCE: boolean(),
    referenceId: text(),
    metadata: text(),
  },
  (table) => [index("oauth_application_user_idx").on(table.userId)],
);

const oauthRefreshToken = pgTable(
  "oauth_refresh_token",
  {
    id: text().notNull().primaryKey(),
    token: text().notNull().unique(),
    clientId: text()
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    sessionId: text().references(() => session.id, { onDelete: "set null" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    referenceId: text(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    revoked: timestamp({ withTimezone: true }),
    authTime: timestamp({ withTimezone: true }),
    scopes: text().array().notNull(),
  },
  (table) => [
    index("oauth_refresh_token_client_idx").on(table.clientId),
    index("oauth_refresh_token_session_idx").on(table.sessionId),
    index("oauth_refresh_token_user_idx").on(table.userId),
  ],
);

const oauthAccessToken = pgTable(
  "oauth_access_token",
  {
    id: text().notNull().primaryKey(),
    token: text().notNull().unique(),
    clientId: text()
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    sessionId: text().references(() => session.id, { onDelete: "set null" }),
    userId: text().references(() => user.id, { onDelete: "cascade" }),
    referenceId: text(),
    refreshId: text().references(() => oauthRefreshToken.id, { onDelete: "set null" }),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    scopes: text().array().notNull(),
  },
  (table) => [
    index("oauth_access_token_client_idx").on(table.clientId),
    index("oauth_access_token_session_idx").on(table.sessionId),
    index("oauth_access_token_user_idx").on(table.userId),
    index("oauth_access_token_refresh_idx").on(table.refreshId),
  ],
);

const oauthConsent = pgTable(
  "oauth_consent",
  {
    id: text().notNull().primaryKey(),
    clientId: text()
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    referenceId: text(),
    scopes: text().array().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("oauth_consent_client_idx").on(table.clientId),
    index("oauth_consent_user_idx").on(table.userId),
    index("oauth_consent_reference_idx").on(table.referenceId),
  ],
);

export {
  user,
  session,
  account,
  verification,
  passkey,
  jwks,
  oauthClient,
  oauthRefreshToken,
  oauthAccessToken,
  oauthConsent,
  oauthClient as oauthApplication,
};
