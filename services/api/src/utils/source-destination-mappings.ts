import {
  getDestinationsForSource as getDestinationsForSourceInMachine,
  getSourcesForDestination as getSourcesForDestinationInMachine,
  getUserMappings as getUserMappingsInMachine,
  MAPPING_LIMIT_ERROR_MESSAGE,
  setDestinationsForSource as setDestinationsForSourceInMachine,
  setSourcesForDestination as setSourcesForDestinationInMachine,
} from "@keeper.sh/machine-orchestration";
import type { MappingServiceDependencies } from "@keeper.sh/machine-orchestration";

const resolveDependencies = async (): Promise<MappingServiceDependencies> => {
  const { database, premiumService } = await import("@/context");
  return {
    database,
    isMappingCountAllowed: async (userId, nextMappingCount) => {
      const userPlan = await premiumService.getUserPlan(userId);
      const mappingLimit = premiumService.getMappingLimit(userPlan);
      return nextMappingCount <= mappingLimit;
    },
  };
};

const getUserMappings = async (userId: string) => {
  const dependencies = await resolveDependencies();
  return getUserMappingsInMachine(dependencies.database, userId);
};

const getDestinationsForSource = async (userId: string, sourceCalendarId: string) => {
  const dependencies = await resolveDependencies();
  return getDestinationsForSourceInMachine(dependencies.database, userId, sourceCalendarId);
};

const getSourcesForDestination = async (userId: string, destinationCalendarId: string) => {
  const dependencies = await resolveDependencies();
  return getSourcesForDestinationInMachine(dependencies.database, userId, destinationCalendarId);
};

const setDestinationsForSource = async (
  userId: string,
  sourceCalendarId: string,
  destinationCalendarIds: string[],
): Promise<void> =>
  {
    const dependencies = await resolveDependencies();
    return setDestinationsForSourceInMachine({
      dependencies,
      destinationCalendarIds,
      sourceCalendarId,
      userId,
    });
  };

const setSourcesForDestination = async (
  userId: string,
  destinationCalendarId: string,
  sourceCalendarIds: string[],
): Promise<void> =>
  {
    const dependencies = await resolveDependencies();
    return setSourcesForDestinationInMachine({
      dependencies,
      destinationCalendarId,
      sourceCalendarIds,
      userId,
    });
  };

export {
  getUserMappings,
  getDestinationsForSource,
  getSourcesForDestination,
  MAPPING_LIMIT_ERROR_MESSAGE,
  setDestinationsForSource,
  setSourcesForDestination,
};
