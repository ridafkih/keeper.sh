import { withAuth, withWideEvent } from "@/utils/middleware";
import type { AuthenticatedRouteCallback } from "@/utils/middleware";
import { getUserMappings } from "@/utils/source-destination-mappings";

interface MappingPair {
  sourceCalendarId: string;
  destinationCalendarId: string;
}

interface MappingsRouteDependencies {
  listMappings: (userId: string) => Promise<MappingPair[]>;
}

const handleMappingsRoute = async (
  { userId }: { userId: string },
  dependencies: MappingsRouteDependencies,
): Promise<Response> => {
  const mappings = await dependencies.listMappings(userId);
  return Response.json({
    mappings: mappings.map(({ destinationCalendarId, sourceCalendarId }) => ({
      destinationCalendarId,
      sourceCalendarId,
    })),
  });
};

const listMappings: AuthenticatedRouteCallback = ({ userId }) =>
  handleMappingsRoute({ userId }, { listMappings: getUserMappings });

const GET = withWideEvent(withAuth(listMappings));

export { GET, handleMappingsRoute, listMappings };
