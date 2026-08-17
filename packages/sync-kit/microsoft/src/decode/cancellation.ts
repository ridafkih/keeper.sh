import type { Event as GraphEvent } from "@microsoft/microsoft-graph-types";

const isCancelled = (event: GraphEvent): boolean => event.isCancelled === true;

export { isCancelled };
