import { normalizeDateRange, parseDateRangeParams } from "@keeper.sh/date-utils";
import { createKeeperReadModels } from "@keeper.sh/mcp-server";
import { withAuth, withWideEvent } from "../../../utils/middleware";
import { database } from "../../../context";

const keeperReadModels = createKeeperReadModels(database);

export const GET = withWideEvent(
  withAuth(async ({ request, userId }) => {
    const url = new URL(request.url);
    const { from, to } = parseDateRangeParams(url);
    const { end, start } = normalizeDateRange(from, to);
    const events = await keeperReadModels.getEventsInRange(userId, {
      from: start,
      to: end,
    });
    return Response.json(events);
  }),
);
