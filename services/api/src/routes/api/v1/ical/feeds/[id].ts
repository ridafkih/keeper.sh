import { withV1Auth, withWideEvent } from "@/utils/middleware";
import { deleteIcalFeed, patchIcalFeed } from "@/routes/api/ical/feeds/[id]";

const PATCH = withWideEvent(withV1Auth(patchIcalFeed));

const DELETE = withWideEvent(withV1Auth(deleteIcalFeed));

export { DELETE, PATCH };
