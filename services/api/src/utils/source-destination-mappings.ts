import {
  createSourceDestinationMappingRuntime,
  getDestinationsForSource as getDestinationsForSourceInMachine,
  getSourcesForDestination as getSourcesForDestinationInMachine,
  getUserMappings as getUserMappingsInMachine,
  MAPPING_LIMIT_ERROR_MESSAGE,
  RedisCommandOutboxStore,
  setDestinationsForSource as setDestinationsForSourceInMachine,
  setSourcesForDestination as setSourcesForDestinationInMachine,
  type SourceDestinationMappingFailureEvent,
} from "@keeper.sh/machine-orchestration";
import { SourceDestinationMappingEventType } from "@keeper.sh/state-machines";
import type { SourceDestinationMappingCommand } from "@keeper.sh/state-machines";
import { enqueuePushSync } from "./enqueue-push-sync";

const SOURCE_NOT_FOUND_MESSAGE = "Source calendar not found";
const DESTINATION_NOT_FOUND_MESSAGE = "Destination calendar not found";
const DESTINATION_SET_INVALID_MESSAGE = "Some destination calendars not found";
const SOURCE_SET_INVALID_MESSAGE = "Some source calendars not found";

const classifyMappingFailure = (input: {
  error: unknown;
  invalidSetMessage: string;
  notFoundMessage: string;
}): SourceDestinationMappingFailureEvent | null => {
  if (!(input.error instanceof Error)) {
    return null;
  }
  if (input.error.message === MAPPING_LIMIT_ERROR_MESSAGE) {
    return { type: SourceDestinationMappingEventType.LIMIT_REJECTED };
  }
  if (input.error.message === input.invalidSetMessage) {
    return { type: SourceDestinationMappingEventType.INVALID_SET_REJECTED };
  }
  if (input.error.message === input.notFoundMessage) {
    return { type: SourceDestinationMappingEventType.PRIMARY_NOT_FOUND_REJECTED };
  }
  return null;
};

const resolveDependencies = async (userId: string) => {
  const { database, premiumService, redis } = await import("@/context");
  const plan = await premiumService.getUserPlan(userId);

  return {
    database,
    outboxStore: new RedisCommandOutboxStore<SourceDestinationMappingCommand>({
      keyPrefix: "machine:outbox:source-destination-mapping",
      redis,
    }),
    plan,
    resolveIsMappingCountAllowed: (nextMappingCount: number) =>
      nextMappingCount <= premiumService.getMappingLimit(plan),
  };
};

const runMappingRuntime = async (input: {
  userId: string;
  aggregateId: string;
  applyUpdate: () => Promise<boolean>;
  invalidSetMessage: string;
  notFoundMessage: string;
}): Promise<void> => {
  const dependencies = await resolveDependencies(input.userId);
  let sequence = 0;
  const runtime = createSourceDestinationMappingRuntime({
    aggregateId: input.aggregateId,
    classifyFailure: (error) =>
      classifyMappingFailure({
        error,
        invalidSetMessage: input.invalidSetMessage,
        notFoundMessage: input.notFoundMessage,
      }),
    createEnvelope: (event) => {
      sequence += 1;
      return {
        actor: { id: "api-source-mapping", type: "system" },
        event,
        id: `${input.aggregateId}:${sequence}:${event.type}`,
        occurredAt: new Date().toISOString(),
      };
    },
    handlers: {
      applyUpdate: input.applyUpdate,
      requestSync: () => enqueuePushSync(input.userId, dependencies.plan),
    },
    onRuntimeEvent: () => Promise.resolve(),
    outboxStore: dependencies.outboxStore,
  });

  const transition = await runtime.applyUpdate();
  const outputs = new Set(transition.outputs.map((output) => output.type));

  if (outputs.has("MAPPING_LIMIT_REJECTED")) {
    throw new Error(MAPPING_LIMIT_ERROR_MESSAGE);
  }
  if (outputs.has("PRIMARY_NOT_FOUND_REJECTED")) {
    throw new Error(input.notFoundMessage);
  }
  if (outputs.has("INVALID_SOURCE_SET_REJECTED")) {
    throw new Error(input.invalidSetMessage);
  }
};

const getUserMappings = async (userId: string) => {
  const { database } = await import("@/context");
  return getUserMappingsInMachine(database, userId);
};

const getDestinationsForSource = async (userId: string, sourceCalendarId: string) => {
  const { database } = await import("@/context");
  return getDestinationsForSourceInMachine(database, userId, sourceCalendarId);
};

const getSourcesForDestination = async (userId: string, destinationCalendarId: string) => {
  const { database } = await import("@/context");
  return getSourcesForDestinationInMachine(database, userId, destinationCalendarId);
};

const setDestinationsForSource = async (
  userId: string,
  sourceCalendarId: string,
  destinationCalendarIds: string[],
): Promise<void> => {
  const dependencies = await resolveDependencies(userId);
  return runMappingRuntime({
    aggregateId: `${userId}:source:${sourceCalendarId}`,
    applyUpdate: () =>
      setDestinationsForSourceInMachine({
        dependencies: {
          database: dependencies.database,
          isMappingCountAllowed: (_userId, nextMappingCount) =>
            Promise.resolve(dependencies.resolveIsMappingCountAllowed(nextMappingCount)),
        },
        destinationCalendarIds,
        sourceCalendarId,
        userId,
      }),
    invalidSetMessage: DESTINATION_SET_INVALID_MESSAGE,
    notFoundMessage: SOURCE_NOT_FOUND_MESSAGE,
    userId,
  });
};

const setSourcesForDestination = async (
  userId: string,
  destinationCalendarId: string,
  sourceCalendarIds: string[],
): Promise<void> => {
  const dependencies = await resolveDependencies(userId);
  return runMappingRuntime({
    aggregateId: `${userId}:destination:${destinationCalendarId}`,
    applyUpdate: () =>
      setSourcesForDestinationInMachine({
        dependencies: {
          database: dependencies.database,
          isMappingCountAllowed: (_userId, nextMappingCount) =>
            Promise.resolve(dependencies.resolveIsMappingCountAllowed(nextMappingCount)),
        },
        destinationCalendarId,
        sourceCalendarIds,
        userId,
      }),
    invalidSetMessage: SOURCE_SET_INVALID_MESSAGE,
    notFoundMessage: DESTINATION_NOT_FOUND_MESSAGE,
    userId,
  });
};

export {
  DESTINATION_NOT_FOUND_MESSAGE,
  DESTINATION_SET_INVALID_MESSAGE,
  getUserMappings,
  getDestinationsForSource,
  getSourcesForDestination,
  MAPPING_LIMIT_ERROR_MESSAGE,
  setDestinationsForSource,
  setSourcesForDestination,
  SOURCE_NOT_FOUND_MESSAGE,
  SOURCE_SET_INVALID_MESSAGE,
};
