import { canonicalEventFingerprint, projectCanonicalEvent, projectIcsFeed } from "../../src/index";
import type { CanonicalEvent, IcsOptions } from "../../src/index";
import { testScope } from "./feed";
import { testOptions } from "./options";

const canonicalEventsOf = (
  body: string,
  options: IcsOptions = testOptions(),
): readonly CanonicalEvent[] => {
  const projection = projectIcsFeed({
    body,
    scope: testScope,
    previousContentHash: null,
    options,
  });
  if (!projection.ok) {
    return [];
  }
  return projection.value.listing.events.flatMap((event) => [
    projectCanonicalEvent({
      identity: { kind: "master", uid: event.uid },
      content: event.content,
      revision: { sequence: null, lastModified: null, stamp: null, created: null },
      cancelled: false,
      provenance: { kind: "foreign" },
    }),
  ]);
};

const fingerprintsOf = (body: string, options: IcsOptions = testOptions()): readonly string[] =>
  canonicalEventsOf(body, options).map((event) => canonicalEventFingerprint(event).value);

const soleFingerprint = (body: string, options: IcsOptions = testOptions()): string => {
  const [fingerprint] = fingerprintsOf(body, options);
  if (!fingerprint) {
    return "none";
  }
  return fingerprint;
};

export { canonicalEventsOf, fingerprintsOf, soleFingerprint };
