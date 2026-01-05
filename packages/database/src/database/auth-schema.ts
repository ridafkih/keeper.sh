import { boolean, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

const user = pgTable("user", {
  createdAt: timestamp().notNull().defaultNow(),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  id: text().notNull().primaryKey(),
  image: text(),
  name: text().notNull(),
  updatedAt: timestamp().notNull().defaultNow(),
  username: text().unique(),
});

const session = pgTable("session", {
  createdAt: timestamp().notNull().defaultNow(),
  expiresAt: timestamp().notNull(),
  id: text().notNull().primaryKey(),
  ipAddress: text(),
  token: text().notNull().unique(),
  updatedAt: timestamp().notNull().defaultNow(),
  userAgent: text(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

const account = pgTable("account", {
  accessToken: text(),
  accessTokenExpiresAt: timestamp(),
  accountId: text().notNull(),
  createdAt: timestamp().notNull().defaultNow(),
  id: text().notNull().primaryKey(),
  idToken: text(),
  password: text(),
  providerId: text().notNull(),
  refreshToken: text(),
  refreshTokenExpiresAt: timestamp(),
  scope: text(),
  updatedAt: timestamp().notNull().defaultNow(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

const verification = pgTable("verification", {
  createdAt: timestamp().notNull().defaultNow(),
  expiresAt: timestamp().notNull(),
  id: text().notNull().primaryKey(),
  identifier: text().notNull(),
  updatedAt: timestamp().notNull().defaultNow(),
  value: text().notNull(),
});

const passkey = pgTable("passkey", {
  aaguid: text(),
  backedUp: boolean().notNull(),
  counter: integer().notNull(),
  createdAt: timestamp(),
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

export { user, session, account, verification, passkey };
