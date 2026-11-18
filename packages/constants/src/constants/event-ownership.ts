/*
 * Every event Keeper.sh writes carries the id of the destination calendar that wrote it, so
 * two destinations writing into one shared calendar can tell their events apart. Google keeps
 * it as a private extended property and CalDAV as a non-standard VEVENT property.
 */
const EVENT_OWNER_GOOGLE_PROPERTY = "keeperDestination";
const EVENT_OWNER_ICS_PROPERTY = "X-KEEPER-DESTINATION";

/*
 * Events written before ownership tags existed are tagged in place a bounded number at a time,
 * so a destination with thousands of mirrors spreads the rewrite over several runs.
 */
const EVENT_OWNER_BACKFILL_PER_RUN = 50;

export { EVENT_OWNER_BACKFILL_PER_RUN, EVENT_OWNER_GOOGLE_PROPERTY, EVENT_OWNER_ICS_PROPERTY };
