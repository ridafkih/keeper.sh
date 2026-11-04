import { buildMicrosoftOAuthCredentials } from "@keeper.sh/calendar";
import env from "./env";

const microsoftCredentials = buildMicrosoftOAuthCredentials(env);

export { microsoftCredentials };
