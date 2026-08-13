import {
  resolveDatabaseErrorClassification,
  type DatabaseErrorClassification,
} from "@keeper.sh/database";
import { widelog } from "@/utils/logging";
import { ErrorResponse } from "@/utils/responses";

const DATABASE_UNAVAILABLE_MESSAGE = "Service temporarily unavailable";

const labelFailure = (
  error: unknown,
  fields: Record<string, unknown> & { slug: string },
): DatabaseErrorClassification | null => {
  const databaseError = resolveDatabaseErrorClassification(error);
  if (databaseError?.sqlState) {
    widelog.set("db.error_sqlstate", databaseError.sqlState);
  }
  widelog.errorFields(error, { ...fields, slug: databaseError?.slug ?? fields.slug });
  return databaseError;
};

const labelFailureResponse = (
  error: unknown,
  fields: Record<string, unknown> & { slug: string },
): Response | null => {
  if (labelFailure(error, fields) === null) {
    return null;
  }
  return ErrorResponse.internal(DATABASE_UNAVAILABLE_MESSAGE).toResponse();
};

export { labelFailure, labelFailureResponse };
