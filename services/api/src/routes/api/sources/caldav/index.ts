import { TraversalError } from "arktype";
import { importCalDAVCalendarsSchema } from "@keeper.sh/data-schemas";
import { HTTP_STATUS } from "@keeper.sh/constants";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";
import { widelog } from "@/utils/logging";
import { labelFailureResponse } from "@/utils/error-labelling";
import { caldavSourcesQuerySchema } from "@/utils/request-query";
import {
  CalDAVSourceLimitError,
  getUserCalDAVSources,
  importCalDAVCalendars,
} from "@/utils/caldav-sources";
import type { CalDAVImportResult } from "@/utils/caldav-calendar-import";

const SOURCE_CREATE_FAILED_MESSAGE = "Failed to import CalDAV calendars";

const countByStatus = (
  result: CalDAVImportResult,
  status: CalDAVImportResult["calendars"][number]["status"],
): number => result.calendars.filter((calendar) => calendar.status === status).length;

const resolveImportStatusCode = (importedCount: number): number => {
  if (importedCount > 0) {
    return HTTP_STATUS.CREATED;
  }
  return HTTP_STATUS.OK;
};

const GET = withWideEvent(
  withAuth(async ({ request, userId }) => {
    const url = new URL(request.url);
    const query = Object.fromEntries(url.searchParams.entries());
    const provider = url.searchParams.get("provider");

    if (!caldavSourcesQuerySchema.allows(query)) {
      return ErrorResponse.badRequest("Invalid query params").toResponse();
    }

    if (provider) {
      const sources = await getUserCalDAVSources(userId, provider);
      return Response.json(sources);
    }

    const sources = await getUserCalDAVSources(userId);
    return Response.json(sources);
  }),
);

const POST = withWideEvent(
  withAuth(async ({ request, userId }) => {
    const body = await request.json();

    try {
      const data = importCalDAVCalendarsSchema.assert(body);

      widelog.set("provider.name", data.provider);
      widelog.set("caldav.calendars_requested", data.calendars.length);

      const result = await importCalDAVCalendars(userId, data);
      const importedCount = countByStatus(result, "imported");

      widelog.set("account.id", result.accountId);
      widelog.set("caldav.calendars_imported", importedCount);
      widelog.set("caldav.calendars_already_connected", countByStatus(result, "already_connected"));

      return Response.json(result, { status: resolveImportStatusCode(importedCount) });
    } catch (error) {
      if (error instanceof CalDAVSourceLimitError) {
        widelog.errorFields(error, { slug: "account-limit-reached" });
        return ErrorResponse.paymentRequired(error.message).toResponse();
      }
      if (error instanceof TraversalError) {
        widelog.errorFields(error, { slug: "invalid-request-body" });
        return ErrorResponse.badRequest(error.message).toResponse();
      }

      const databaseResponse = labelFailureResponse(error, {
        slug: "caldav-connection-failed",
      });
      if (databaseResponse) {
        return databaseResponse;
      }

      // Fixed message: an arbitrary error's message here may carry SQL text and bound parameters.
      return ErrorResponse.internal(SOURCE_CREATE_FAILED_MESSAGE).toResponse();
    }
  }),
);

export { GET, POST };
