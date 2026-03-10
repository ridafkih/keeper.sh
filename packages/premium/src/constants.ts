import type { Plan } from "@keeper.sh/data-schemas";

const FREE_ACCOUNT_LIMIT = 2;
const PRO_ACCOUNT_LIMIT = Infinity;

const FREE_MAPPING_LIMIT = 3;
const PRO_MAPPING_LIMIT = Infinity;

export { FREE_ACCOUNT_LIMIT, PRO_ACCOUNT_LIMIT, FREE_MAPPING_LIMIT, PRO_MAPPING_LIMIT };
export { planSchema } from "@keeper.sh/data-schemas";
export type { Plan };
