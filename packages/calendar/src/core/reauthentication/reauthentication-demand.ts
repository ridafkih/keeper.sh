import { REAUTHENTICATION_TOKEN_REFRESH } from "@keeper.sh/constants";
import { calendarAccountsTable } from "@keeper.sh/database/schema";
import { and, eq } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { isOAuthReauthRequiredError } from "../oauth/error-classification";
import {
  readPriorReauthenticationStateWhere,
  recordReauthenticationDemand,
} from "./demand-telemetry";

type ReauthenticationDemandTarget =
  | { calendarAccountId: string }
  | { oauthCredentialId: string; userId: string };

type ReauthenticationDemandDatabase = Pick<PgDatabase<PgQueryResultHKT>, "select" | "update">;

const targetsCalendarAccount = (
  target: ReauthenticationDemandTarget,
): target is { calendarAccountId: string } => "calendarAccountId" in target;

const buildTargetFilter = (target: ReauthenticationDemandTarget): SQL => {
  if (targetsCalendarAccount(target)) {
    return eq(calendarAccountsTable.id, target.calendarAccountId);
  }

  const filter = and(
    eq(calendarAccountsTable.userId, target.userId),
    eq(calendarAccountsTable.oauthCredentialId, target.oauthCredentialId),
  );

  if (!filter) {
    throw new Error("Unable to build a reauthentication demand filter");
  }

  return filter;
};

const fallbackDemandAccountId = (target: ReauthenticationDemandTarget): string | null => {
  if (targetsCalendarAccount(target)) {
    return target.calendarAccountId;
  }

  return null;
};

const raiseReauthenticationDemand = async (
  database: ReauthenticationDemandDatabase,
  target: ReauthenticationDemandTarget,
): Promise<void> => {
  const filter = buildTargetFilter(target);
  const prior = await readPriorReauthenticationStateWhere(database, filter);

  await database
    .update(calendarAccountsTable)
    .set({
      needsReauthentication: true,
      reauthenticationSource: REAUTHENTICATION_TOKEN_REFRESH,
    })
    .where(filter);

  recordReauthenticationDemand({
    accountId: prior?.id ?? fallbackDemandAccountId(target),
    action: "raise",
    previous: prior?.needsReauthentication ?? null,
    provenance: REAUTHENTICATION_TOKEN_REFRESH,
    recordedProvenance: prior?.reauthenticationSource,
    signal: "oauth-refresh-rejected",
  });
};

const withReauthenticationDemand = async <TResult>(
  database: ReauthenticationDemandDatabase,
  target: ReauthenticationDemandTarget,
  run: () => Promise<TResult>,
): Promise<TResult> => {
  try {
    return await run();
  } catch (error) {
    if (isOAuthReauthRequiredError(error)) {
      await raiseReauthenticationDemand(database, target);
    }
    throw error;
  }
};

export { withReauthenticationDemand };
export type { ReauthenticationDemandDatabase, ReauthenticationDemandTarget };
