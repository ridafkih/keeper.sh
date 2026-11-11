import { withV1Auth, withWideEvent } from "@/utils/middleware";
import { listMappings } from "@/routes/api/mappings";

const GET = withWideEvent(withV1Auth(listMappings));

export { GET };
