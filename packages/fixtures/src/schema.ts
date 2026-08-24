import { type } from "arktype";

const fixtureExpectationSchema = type({
  "containsExceptions?": "boolean",
  "containsRecurrence?": "boolean",
  "containsTimeZone?": "boolean",
  "+": "reject",
});
type FixtureExpectation = typeof fixtureExpectationSchema.infer;

const fixtureSourceSchema = type({
  fileName: "string",
  id: "string",
  "description?": "string",
  "enabled?": "boolean",
  "expected?": fixtureExpectationSchema,
  "sourceUrl?": "string.url",
  "tags?": "string[]",
  "+": "reject",
});
type FixtureSource = typeof fixtureSourceSchema.infer;

const fixtureManifestSchema = fixtureSourceSchema.array();
type FixtureManifest = typeof fixtureManifestSchema.infer;

export { fixtureExpectationSchema, fixtureSourceSchema, fixtureManifestSchema };
export type { FixtureExpectation, FixtureSource, FixtureManifest };
