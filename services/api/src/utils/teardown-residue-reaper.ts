import { createTeardownResidueStore } from "@keeper.sh/calendar";
import type { TeardownResidueStore } from "@keeper.sh/calendar";
import type { database as databaseInstance } from "@/context";

interface ApiTeardownResidueContext {
  database: typeof databaseInstance;
  encryptionKey: string | null;
}

const createApiTeardownResidueStore = (
  context: ApiTeardownResidueContext,
): TeardownResidueStore =>
  createTeardownResidueStore({
    database: context.database,
    encryptionKey: context.encryptionKey,
    now: () => new Date(),
  });

export { createApiTeardownResidueStore };
export { createTeardownResidueReaper } from "@keeper.sh/calendar";
export type { ApiTeardownResidueContext };
