import { classifyDatabaseError } from "@keeper.sh/database";
import { widelog } from "@/utils/logging";

const labelFailure = (
  error: unknown,
  fields: Record<string, unknown> & { slug: string },
): void => {
  const databaseError = classifyDatabaseError(error);
  if (databaseError?.sqlState) {
    widelog.set("db.error_sqlstate", databaseError.sqlState);
  }
  widelog.errorFields(error, { ...fields, slug: databaseError?.slug ?? fields.slug });
};

export { labelFailure };
