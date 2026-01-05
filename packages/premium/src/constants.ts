import type { Plan } from "@keeper.sh/data-schemas";

const FREE_SOURCE_LIMIT = 2;
const PRO_SOURCE_LIMIT = Infinity;

const FREE_DESTINATION_LIMIT = 1;
const PRO_DESTINATION_LIMIT = Infinity;

export { FREE_SOURCE_LIMIT, PRO_SOURCE_LIMIT, FREE_DESTINATION_LIMIT, PRO_DESTINATION_LIMIT };
export { planSchema } from "@keeper.sh/data-schemas";
export type { Plan };
