const davPreconditions = ["validSyncToken", "numberOfMatchesWithinLimits"] as const;
type DavPrecondition = (typeof davPreconditions)[number];

export { davPreconditions };
export type { DavPrecondition };
