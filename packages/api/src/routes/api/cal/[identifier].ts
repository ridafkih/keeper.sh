import { withTracing } from "../../../utils/middleware";
import { generateUserCalendar } from "../../../utils/ical";
import { ErrorResponse } from "../../../utils/responses";

export const GET = withTracing(async ({ params }) => {
  const { identifier } = params;

  if (!identifier?.endsWith(".ics")) {
    return ErrorResponse.notFound();
  }

  const cleanIdentifier = identifier.slice(0, -4);
  const calendar = await generateUserCalendar(cleanIdentifier);

  if (calendar === null) {
    return ErrorResponse.notFound();
  }

  return new Response(calendar, {
    headers: { "Content-Type": "text/calendar; charset=utf-8" },
  });
});
