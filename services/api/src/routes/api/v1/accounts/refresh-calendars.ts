import { withV1Auth, withWideEvent } from "@/utils/middleware";
import { refreshAllAccountCalendars } from "@/routes/api/accounts/refresh-calendars";

const POST = withWideEvent(withV1Auth(refreshAllAccountCalendars));

export { POST };
