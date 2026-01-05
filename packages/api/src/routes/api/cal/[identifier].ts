import { withTracing } from "../../../utils/middleware";
import { generateUserCalendar } from "../../../utils/ical";
import { ErrorResponse } from "../../../utils/responses";

const ICS_EXTENSION_LENGTH = 4;

const GET = withTracing(async ({ params }) => {
  const { identifier } = params;

  if (!identifier?.endsWith(".ics")) {
    return ErrorResponse.notFound().toResponse();
  }

  const cleanIdentifier = identifier.slice(0, -ICS_EXTENSION_LENGTH);
  const calendar = await generateUserCalendar(cleanIdentifier);

  if (calendar === null) {
    return ErrorResponse.notFound().toResponse();
  }

  return new Response(calendar, {
    headers: { "Content-Type": "text/calendar; charset=utf-8" },
  });
});

export { GET };
