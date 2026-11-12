import { type } from "entrykit";

const buildIdentity = type({
  COMMIT_SHA: "string > 0",
  VERSION: "string > 0",
  ENV: "'development' | 'production' | 'test'",
}).assert(process.env);

export { buildIdentity };
