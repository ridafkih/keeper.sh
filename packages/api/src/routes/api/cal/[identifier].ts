import { withTracing } from "../../../utils/middleware";
import { generateUserCalendar } from "../../../utils/ical";

export const GET = withTracing(async ({ params }) => {
  const { identifier } = params;

  if (!identifier?.endsWith(".ics")) {
    return new Response("Not found", { status: 404 });
  }

  const cleanIdentifier = identifier.slice(0, -4);
  const calendar = await generateUserCalendar(cleanIdentifier);

  if (calendar === null) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(calendar, {
    headers: { "Content-Type": "text/calendar; charset=utf-8" },
  });
});
