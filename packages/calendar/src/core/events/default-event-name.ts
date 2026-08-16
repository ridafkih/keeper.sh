/*
 * The name a source event with no title of its own is given. It stands in for the missing
 * title on every path that has to name the event, so the value has to be reachable from
 * the pure sync code as well as from the database reads that project it.
 */
const DEFAULT_EVENT_NAME = "Busy";

export { DEFAULT_EVENT_NAME };
