import { normalizeDateRange, parseDateRangeParams } from "@/utils/date-range";
import { createKeeperApi } from "@/read-models";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { database, encryptionKey } from "@/context";

const keeperApi = createKeeperApi(database, { encryptionKey });

export const GET = withWideEvent(
  withAuth(async ({ request, userId }) => {
    const url = new URL(request.url);
    const { from, to } = parseDateRangeParams(url);
    const { end, start } = normalizeDateRange(from, to);
    const events = await keeperApi.getEventsInRange(userId, {
      from: start,
      to: end,
    });
    return Response.json(events);
  }),
);
