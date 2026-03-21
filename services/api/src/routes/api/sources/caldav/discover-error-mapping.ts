import { isCalDAVAuthenticationError } from "@keeper.sh/calendar";
import { ErrorResponse } from "@/utils/responses";

const mapCalDAVDiscoverError = (error: unknown): {
  response: Response;
  slug: string;
} => {
  if (isCalDAVAuthenticationError(error)) {
    return {
      response: ErrorResponse.unauthorized("Invalid credentials").toResponse(),
      slug: "caldav-auth-failed",
    };
  }

  return {
    response: ErrorResponse.badRequest("Failed to discover calendars").toResponse(),
    slug: "caldav-connection-failed",
  };
};

export { mapCalDAVDiscoverError };
