import env from "@keeper.sh/env/database";
import { drizzle } from "drizzle-orm/singlestore";

export const database = drizzle(env.DATABASE_URL);
