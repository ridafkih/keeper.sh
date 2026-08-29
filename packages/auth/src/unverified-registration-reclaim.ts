import { type } from "arktype";
import { hashPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import {
  account as accountTable,
  user as userTable,
  verification as verificationTable,
} from "@keeper.sh/database/auth-schema";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";

const RECLAIM_IDENTIFIER_PREFIX = "unverified-registration-reclaim:";
const RECLAIM_EXPIRES_IN_MS = 3_600_000;
const CREDENTIAL_PROVIDER_ID = "credential";

const pendingReclaimSchema = type({
  name: "string",
  passwordHash: "string",
});

const signUpBodySchema = type({
  name: "string",
  password: "string",
});

interface RecordPendingReclaimParams {
  name: string;
  password: string;
  user: ReclaimableUser;
}

interface ReclaimableUser {
  email: string;
  id: string;
}

const buildReclaimIdentifier = (email: string): string =>
  `${RECLAIM_IDENTIFIER_PREFIX}${email.toLowerCase()}`;

const readSignUpBody = async (request: Request) => {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/x-www-form-urlencoded")) {
    return signUpBodySchema.assert(Object.fromEntries(await request.formData()));
  }

  if (contentType.includes("application/json")) {
    return signUpBodySchema.assert(await request.json());
  }

  throw new TypeError(`Unsupported sign-up media type for reclaim capture: ${contentType}`);
};

const createUnverifiedRegistrationReclaim = (database: BunSQLDatabase) => {
  const readAccounts = (userId: string) =>
    database
      .select({ id: accountTable.id, providerId: accountTable.providerId })
      .from(accountTable)
      .where(eq(accountTable.userId, userId));

  const findCredentialAccount = async (userId: string) => {
    const [credentialAccount] = await database
      .select({ id: accountTable.id })
      .from(accountTable)
      .where(
        and(
          eq(accountTable.userId, userId),
          eq(accountTable.providerId, CREDENTIAL_PROVIDER_ID),
        ),
      )
      .limit(1);

    return credentialAccount ?? null;
  };

  const recordPendingReclaim = async ({
    name,
    password,
    user,
  }: RecordPendingReclaimParams): Promise<boolean> => {
    const accounts = await readAccounts(user.id);
    const holdsCredentialAccount = accounts.some(
      (account) => account.providerId === CREDENTIAL_PROVIDER_ID,
    );
    const holdsProviderAssertedIdentity = accounts.some(
      (account) => account.providerId !== CREDENTIAL_PROVIDER_ID,
    );

    if (!holdsCredentialAccount || holdsProviderAssertedIdentity) {
      return false;
    }

    const identifier = buildReclaimIdentifier(user.email);
    const passwordHash = await hashPassword(password);
    const now = new Date();

    await database
      .delete(verificationTable)
      .where(eq(verificationTable.identifier, identifier));

    await database.insert(verificationTable).values({
      createdAt: now,
      expiresAt: new Date(now.getTime() + RECLAIM_EXPIRES_IN_MS),
      id: crypto.randomUUID(),
      identifier,
      updatedAt: now,
      value: JSON.stringify(pendingReclaimSchema.assert({ name, passwordHash })),
    });

    return true;
  };

  const applyPendingReclaim = async (user: ReclaimableUser): Promise<void> => {
    const identifier = buildReclaimIdentifier(user.email);

    const [pendingRow] = await database
      .select()
      .from(verificationTable)
      .where(eq(verificationTable.identifier, identifier))
      .limit(1);

    if (!pendingRow) {
      return;
    }

    await database
      .delete(verificationTable)
      .where(eq(verificationTable.identifier, identifier));

    if (pendingRow.expiresAt.getTime() <= Date.now()) {
      return;
    }

    const credentialAccount = await findCredentialAccount(user.id);

    if (!credentialAccount) {
      throw new Error(
        `Pending registration reclaim for user ${user.id} has no credential account to restore`,
      );
    }

    const pending = pendingReclaimSchema.assert(JSON.parse(pendingRow.value));
    const now = new Date();

    await database
      .update(accountTable)
      .set({ password: pending.passwordHash, updatedAt: now })
      .where(eq(accountTable.id, credentialAccount.id));

    await database
      .update(userTable)
      .set({ name: pending.name, updatedAt: now })
      .where(eq(userTable.id, user.id));
  };

  return { applyPendingReclaim, recordPendingReclaim };
};

export { createUnverifiedRegistrationReclaim, readSignUpBody };
export type { ReclaimableUser };
