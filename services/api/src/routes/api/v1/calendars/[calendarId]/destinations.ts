import { withV1Auth, withWideEvent } from "@/utils/middleware";
import { withParamAsId } from "@/utils/route-params";
import { putSourceDestinations } from "@/routes/api/sources/[id]/destinations";

const PUT = withWideEvent(withV1Auth(withParamAsId("calendarId", putSourceDestinations)));

export { PUT };
