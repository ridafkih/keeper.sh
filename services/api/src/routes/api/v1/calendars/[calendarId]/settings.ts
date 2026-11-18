import { withV1Auth, withWideEvent } from "@/utils/middleware";
import { withParamAsId } from "@/utils/route-params";
import { getSourceCalendar, patchSourceCalendar } from "@/routes/api/sources/[id]";

const GET = withWideEvent(withV1Auth(withParamAsId("calendarId", getSourceCalendar)));

const PATCH = withWideEvent(withV1Auth(withParamAsId("calendarId", patchSourceCalendar)));

export { GET, PATCH };
