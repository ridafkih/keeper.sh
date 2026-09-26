import { decryptPassword, encryptPassword } from "@keeper.sh/database";
import { ewsCredentialsTable } from "@keeper.sh/database/schema";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { eq } from "drizzle-orm";
import { parseEwsConfig, ewsConnectionIdentity } from "./config";
import type { EwsRuntimeOptions } from "./config";
import { getEwsUserAccessToken } from "./oauth";
import { EwsError } from "./client";

// Serialize refreshes across API, source reads and destination writes. Re-read the
// Encrypted row under the lock so rotating refresh tokens never use a stale copy.
const createEwsTokenProvider =
  (
    database: BunSQLDatabase,
    accountId: string,
    key: string,
    options: EwsRuntimeOptions = {},
  ): NonNullable<EwsRuntimeOptions["getAccessToken"]> =>
  (expected) =>
    database.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(ewsCredentialsTable)
        .where(eq(ewsCredentialsTable.accountId, accountId))
        .for("update")
        .limit(1);
      if (!row) {
        throw new EwsError("OAuthTokenRejected", 401);
      }
      const current = parseEwsConfig(
        JSON.parse(decryptPassword(row.encryptedConfig, key)),
      );
      if (
        current.auth.type !== "oauth2-user" ||
        expected.auth.type !== "oauth2-user" ||
        ewsConnectionIdentity(current) !== ewsConnectionIdentity(expected) ||
        current.auth.tokenUrl !== expected.auth.tokenUrl ||
        current.auth.scope !== expected.auth.scope
      ) {
        throw new EwsError("ConnectionChanged");
      }
      const before = JSON.stringify(current);
      const token = await getEwsUserAccessToken(current, options);
      if (JSON.stringify(current) !== before) {
        await tx
          .update(ewsCredentialsTable)
          .set({
            encryptedConfig: encryptPassword(JSON.stringify(current), key),
            updatedAt: new Date(),
          })
          .where(eq(ewsCredentialsTable.accountId, accountId));
      }
      return token;
    });
export { createEwsTokenProvider };
