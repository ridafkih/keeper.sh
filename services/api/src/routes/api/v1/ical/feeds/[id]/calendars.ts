import { withV1Auth, withWideEvent } from "@/utils/middleware";
import { putFeedCalendars } from "@/routes/api/ical/feeds/[id]/calendars";

const PUT = withWideEvent(withV1Auth(putFeedCalendars));

export { PUT };
