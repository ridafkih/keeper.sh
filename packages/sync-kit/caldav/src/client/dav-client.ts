import type { ElementCompact } from "xml-js";
import { DAVClient, DAVNamespaceShort } from "tsdav";
import type { DavPrecondition } from "../errors/precondition";
import { listed } from "../xml/listed";
import type { AuthenticatingFetchOptions } from "./authenticating-fetch";
import { createAuthenticatingFetch } from "./authenticating-fetch";
import { releaseResponseBody } from "./response-body";

interface DavText {
  readonly status: number;
  readonly body: string;
}

interface DavProperty {
  readonly href: string;
  readonly status: number;
  readonly etag: string | null;
  readonly reports: readonly string[];
  readonly collectionTag: string | null;
  readonly syncToken: string | null;
  readonly privileges: readonly string[];
  readonly precondition: DavPrecondition | null;
}

interface DavProperties {
  readonly status: number;
  readonly rows: readonly DavProperty[];
}

interface DavWrite {
  readonly status: number;
  readonly etag: string | null;
}

interface DavCall {
  readonly client: DAVClient;
  readonly transport: typeof fetch;
  readonly signal: AbortSignal;
}

const createCalDAVClient = (options: AuthenticatingFetchOptions): DAVClient =>
  new DAVClient({
    serverUrl: options.credentials.serverUrl,
    credentials: {
      username: options.credentials.username,
      password: options.credentials.password,
    },
    authMethod: "Custom",
    authFunction: () => Promise.resolve({}),
    defaultAccountType: "caldav",
    fetch: createAuthenticatingFetch(options),
  });

const transportOf = (client: DAVClient): typeof fetch => client.fetchOverride;

const textOf = (raw: unknown): string => {
  if (typeof raw === "string") {
    return raw;
  }
  return "";
};

const reportRaw = async (
  call: DavCall,
  url: string,
  body: ElementCompact,
  depth: "0" | "1",
): Promise<DavText> => {
  const answered = await call.client.davRequest({
    url,
    init: {
      method: "REPORT",
      headers: { depth },
      namespace: DAVNamespaceShort.DAV,
      body,
    },
    parseOutgoing: false,
    fetchOptions: { signal: call.signal },
    fetch: call.transport,
  });
  const [row] = answered;
  if (!row) {
    return { status: 0, body: "" };
  }
  return { status: row.status, body: textOf(row.raw) };
};

const valueOf = (property: unknown): string | null => {
  if (typeof property === "string") {
    return property;
  }
  if (typeof property === "number") {
    return String(property);
  }
  return null;
};

type XmlBranch = Record<string, unknown> | undefined | null;

interface ReportEntry {
  readonly report?: XmlBranch;
}

interface SupportedReportSet {
  readonly supportedReport?: ReportEntry | readonly ReportEntry[];
}

interface PrivilegeSet {
  readonly privilege?: XmlBranch | readonly XmlBranch[];
}

const namesIn = (branch: XmlBranch): readonly string[] => {
  if (!branch) {
    return [];
  }
  return Object.keys(branch);
};

const reportNames = (supported: SupportedReportSet | undefined): readonly string[] =>
  listed(supported?.supportedReport).flatMap((entry) => namesIn(entry.report));

const privilegeNames = (privileges: PrivilegeSet | undefined): readonly string[] =>
  listed(privileges?.privilege).flatMap((entry) => namesIn(entry));

interface PropertyBag {
  readonly getetag?: unknown;
  readonly getctag?: unknown;
  readonly syncToken?: unknown;
  readonly supportedReportSet?: SupportedReportSet;
  readonly currentUserPrivilegeSet?: PrivilegeSet;
}

const preconditionElements: Readonly<Record<string, DavPrecondition>> = {
  "valid-sync-token": "validSyncToken",
  "number-of-matches-within-limits": "numberOfMatchesWithinLimits",
  validSyncToken: "validSyncToken",
  numberOfMatchesWithinLimits: "numberOfMatchesWithinLimits",
};

const preconditionIn = (error: Readonly<Record<string, unknown>> | undefined): DavPrecondition | null => {
  if (!error) {
    return null;
  }
  for (const key of Object.keys(error)) {
    const named = preconditionElements[key];
    if (named) {
      return named;
    }
  }
  return null;
};

const propertyRowOf = (row: {
  href?: string;
  status: number;
  props?: PropertyBag;
  error?: Readonly<Record<string, unknown>>;
}): DavProperty => {
  const props = row.props ?? {};
  return {
    href: row.href ?? "",
    status: row.status,
    etag: valueOf(props.getetag),
    reports: reportNames(props.supportedReportSet),
    collectionTag: valueOf(props.getctag),
    syncToken: valueOf(props.syncToken),
    privileges: privilegeNames(props.currentUserPrivilegeSet),
    precondition: preconditionIn(row.error),
  };
};

const readProperties = async (
  call: DavCall,
  url: string,
  props: ElementCompact,
  depth: "0" | "1",
): Promise<DavProperties> => {
  const answered = await call.client.propfind({
    url,
    props,
    depth,
    fetchOptions: { signal: call.signal },
    fetch: call.transport,
  });
  const [first] = answered;
  return {
    status: first?.status ?? 0,
    rows: answered.map((row) => propertyRowOf(row)),
  };
};

const putResource = async (
  call: DavCall,
  url: string,
  data: string,
  headers: Readonly<Record<string, string>>,
): Promise<DavWrite> => {
  const answered = await call.client.createObject({
    url,
    data,
    headers: { "content-type": "text/calendar; charset=utf-8", ...headers },
    fetchOptions: { signal: call.signal },
    fetch: call.transport,
  });
  const etag = answered.headers.get("etag");
  await releaseResponseBody(answered);
  return { status: answered.status, etag };
};

const removeResource = async (
  call: DavCall,
  url: string,
  headers: Readonly<Record<string, string>>,
): Promise<DavWrite> => {
  const answered = await call.client.deleteObject({
    url,
    headers,
    fetchOptions: { signal: call.signal },
    fetch: call.transport,
  });
  await releaseResponseBody(answered);
  return { status: answered.status, etag: null };
};

export {
  createCalDAVClient,
  readProperties,
  removeResource,
  reportRaw,
  putResource,
  transportOf,
};
export type { DavCall, DavProperties, DavProperty, DavText, DavWrite };
