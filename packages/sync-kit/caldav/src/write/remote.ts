import type { IcsOptions, ParsedVevent } from "@keeper.sh/sync-ical";
import { parseIcsDocument, parseVevent } from "@keeper.sh/sync-ical";
import type {
  Provenance,
  RemoteEvent,
  RemoteEventFacts,
  Result,
} from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import { caldavIcsOptions } from "../canonical";
import { caldavFingerprint } from "../fingerprint";
import { shapedContent } from "./normalize";
import type { DavCall, DavProperties, DavText } from "../client/dav-client";
import { readProperties, reportRaw } from "../client/dav-client";
import { runCalDAVRequest } from "../client/request";
import { absoluteUrl, normalizeResourcePath } from "../identity/resource-path";
import { etagProps, flattenProps, multigetRequestBody } from "../listing/request-shape";
import { readMultistatus } from "../report/multistatus";
import type { WriteSurroundings } from "./surroundings";

const withProvenance = (facts: RemoteEventFacts, provenance: Provenance): RemoteEvent => {
  switch (provenance.kind) {
    case "ours": {
      return { ...facts, provenance };
    }
    case "foreign": {
      return { ...facts, provenance };
    }
    case "indeterminate": {
      return { ...facts, provenance };
    }
    default: {
      return assertNever(provenance);
    }
  }
};

const parseSingleResource = (body: string, options: IcsOptions): ParsedVevent | null => {
  const document = parseIcsDocument(body, options);
  if (document.kind === "unreadable") {
    return null;
  }
  for (const component of document.components) {
    const outcome = parseVevent(component, document, options);
    if (outcome.kind === "parsed") {
      return outcome.event;
    }
  }
  return null;
};

const absentFailure = (surroundings: WriteSurroundings): Result<RemoteEvent> => ({
  ok: false,
  failure: { kind: "notFound", calendar: surroundings.calendar.key, event: null },
});

const readRemoteResource = async (
  surroundings: WriteSurroundings,
  path: string,
): Promise<Result<RemoteEvent>> => {
  const { internals } = surroundings;
  const base = internals.dependencies.credentials.serverUrl;
  const url = absoluteUrl(base, surroundings.collectionPath);
  const answered = await runCalDAVRequest<DavText>(internals, {
    operation: "write",
    collections: [surroundings.collectionPath],
    run: surroundings.run,
    accepts: [],
    call: (call: DavCall) => reportRaw(call, url, multigetRequestBody([path]), "1"),
    statusOf: (value: DavText) => ({
      status: value.status,
      precondition: null,
      retryAfter: null,
    }),
  });
  if (answered.kind === "failed") {
    return { ok: false, failure: answered.failure };
  }
  const row = readMultistatus(answered.value.body).responses.find(
    (response) => normalizeResourcePath(response.href, base) === path,
  );
  if (!row || row.calendarData === null) {
    return absentFailure(surroundings);
  }
  const parsed = parseSingleResource(
    row.calendarData,
    caldavIcsOptions(internals.dependencies, "includeForRoundTrip"),
  );
  if (!parsed) {
    return {
      ok: false,
      failure: { kind: "transport", status: null, disposition: "permanent" },
    };
  }
  const content = shapedContent(parsed.content);
  const facts: RemoteEventFacts = {
    id: { kind: "remoteEventId", value: path },
    deleteHandle: { kind: "deleteHandle", value: path },
    uid: parsed.identity.uid,
    calendar: surroundings.calendar.key,
    revision: parsed.revision.sequence ?? 0,
    version: { kind: "remoteVersion", value: row.etag ?? "" },
    content,
    fingerprint: caldavFingerprint(content, internals.dependencies.hash),
  };
  return { ok: true, value: withProvenance(facts, parsed.provenance) };
};

const readRemoteEtag = async (
  surroundings: WriteSurroundings,
  path: string,
): Promise<string | null> => {
  const { internals } = surroundings;
  const url = absoluteUrl(internals.dependencies.credentials.serverUrl, path);
  const answered = await runCalDAVRequest<DavProperties>(internals, {
    operation: "write",
    collections: [surroundings.collectionPath],
    run: surroundings.run,
    accepts: [],
    call: (call: DavCall) => readProperties(call, url, flattenProps(etagProps()), "0"),
    statusOf: (value: DavProperties) => ({
      status: value.status,
      precondition: null,
      retryAfter: null,
    }),
  });
  if (answered.kind === "failed") {
    return null;
  }
  const [row] = answered.value.rows;
  return row?.etag ?? null;
};

export { readRemoteEtag, readRemoteResource };
