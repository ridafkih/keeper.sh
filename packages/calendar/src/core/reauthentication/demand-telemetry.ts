import { widelog } from "widelogger";
import { calendarAccountsTable } from "@keeper.sh/database/schema";
import { eq } from "drizzle-orm";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql";
import { getErrorMessage } from "../utils/error";

const FIRST_RESULT_LIMIT = 1;

type ReauthenticationDemandAction = "raise" | "clear";

interface ReauthenticationDemandFieldsParams {
  accountId: string;
  action: ReauthenticationDemandAction;
  provenance: string;
  previous: boolean | null;
  signal?: string;
  recordedProvenance?: string | null;
}

type ReauthenticationDemandFields = Record<string, string | number | boolean>;

const buildPreviousFields = (
  action: ReauthenticationDemandAction,
  previous: boolean | null,
): ReauthenticationDemandFields => {
  if (previous === null) {
    return {};
  }
  return {
    "reauth.previous": previous,
    "reauth.transitioned": previous !== (action === "raise"),
  };
};

const buildSignalFields = (signal?: string): ReauthenticationDemandFields => {
  if (!signal) {
    return {};
  }
  return { "reauth.signal": signal };
};

const buildRecordedProvenanceFields = (
  recordedProvenance?: string | null,
): ReauthenticationDemandFields => {
  if (!recordedProvenance) {
    return {};
  }
  return { "reauth.recorded_provenance": recordedProvenance };
};

const resolveReauthenticationDemandAction = (
  needsReauthentication: boolean,
): ReauthenticationDemandAction => {
  if (needsReauthentication) {
    return "raise";
  }
  return "clear";
};

const buildReauthenticationDemandFields = (
  params: ReauthenticationDemandFieldsParams,
): ReauthenticationDemandFields => ({
  "provider.account_id": params.accountId,
  "reauth.action": params.action,
  "reauth.provenance": params.provenance,
  ...buildPreviousFields(params.action, params.previous),
  ...buildSignalFields(params.signal),
  ...buildRecordedProvenanceFields(params.recordedProvenance),
});

const recordReauthenticationDemand = (
  params: ReauthenticationDemandFieldsParams,
): void => {
  for (const [key, value] of Object.entries(buildReauthenticationDemandFields(params))) {
    widelog.set(key, value);
  }
};

interface PriorReauthenticationState {
  needsReauthentication: boolean;
  reauthenticationSource: string | null;
}

const readPriorReauthenticationState = async (
  database: Pick<BunSQLDatabase, "select">,
  accountId: string,
): Promise<PriorReauthenticationState | null> => {
  try {
    const [account] = await database
      .select({
        needsReauthentication: calendarAccountsTable.needsReauthentication,
        reauthenticationSource: calendarAccountsTable.reauthenticationSource,
      })
      .from(calendarAccountsTable)
      .where(eq(calendarAccountsTable.id, accountId))
      .limit(FIRST_RESULT_LIMIT);
    return account ?? null;
  } catch (error) {
    widelog.set("reauth.previous_read_failed", true);
    widelog.set("reauth.previous_read_error", getErrorMessage(error));
    return null;
  }
};

export {
  buildReauthenticationDemandFields,
  readPriorReauthenticationState,
  recordReauthenticationDemand,
  resolveReauthenticationDemandAction,
};
export type {
  ReauthenticationDemandAction,
  ReauthenticationDemandFields,
  ReauthenticationDemandFieldsParams,
};
