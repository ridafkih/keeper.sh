import { withV1Auth, withWideEvent } from "@/utils/middleware";
import { postIcsSource } from "@/routes/api/ics";

const POST = withWideEvent(withV1Auth(postIcsSource));

export { POST };
