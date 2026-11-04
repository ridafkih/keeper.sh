import { withAuth, withWideEvent } from "@/utils/middleware";
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

const GET = withWideEvent(
  withAuth(({ userId }) => handleMappingsRoute({ userId }, { listMappings: getUserMappings })),
);

export { GET, handleMappingsRoute };
