import { RecurrenceMaterializationLimitError } from "@keeper.sh/calendar";
import { EventRangeValidationError } from "@/utils/date-range";
import { ErrorResponse } from "@/utils/responses";

const isClientEventReadError = (error: unknown): boolean =>
  error instanceof RecurrenceMaterializationLimitError
  || error instanceof EventRangeValidationError;

const withEventReadErrorHandling = async (
  respond: () => Promise<Response>,
): Promise<Response> => {
  try {
    return await respond();
  } catch (error) {
    if (error instanceof Error && isClientEventReadError(error)) {
      return ErrorResponse.badRequest(error.message).toResponse();
    }
    throw error;
  }
};

export { withEventReadErrorHandling };
