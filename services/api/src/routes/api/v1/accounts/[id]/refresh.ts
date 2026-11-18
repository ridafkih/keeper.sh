import { withV1Auth, withWideEvent } from "@/utils/middleware";
import { refreshAccount } from "@/routes/api/accounts/[id]/refresh";

const POST = withWideEvent(withV1Auth(refreshAccount));

export { POST };
