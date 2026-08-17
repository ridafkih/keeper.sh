import { xml2js } from "xml-js";
import type { DavPrecondition } from "../errors/precondition";
import { listed } from "../xml/listed";

interface MultistatusResponse {
  readonly href: string;
  readonly status: number;
  readonly etag: string | null;
  readonly calendarData: string | null;
  readonly precondition: DavPrecondition | null;
}

interface MultistatusDocument {
  readonly syncToken: string | null;
  readonly responses: readonly MultistatusResponse[];
  readonly precondition: DavPrecondition | null;
}

type RawFragment = string | number;

interface RawText {
  readonly _text?: RawFragment | readonly RawFragment[];
  readonly _cdata?: RawFragment | readonly RawFragment[];
}

type RawError = Record<string, unknown>;

interface RawProp {
  readonly getetag?: RawText;
  readonly "calendar-data"?: RawText;
}

interface RawPropstat {
  readonly prop?: RawProp;
  readonly status?: RawText;
}

interface RawResponse {
  readonly href?: RawText;
  readonly status?: RawText;
  readonly propstat?: RawPropstat | readonly RawPropstat[];
  readonly error?: RawError;
}

interface RawMultistatus {
  readonly response?: RawResponse | readonly RawResponse[];
  readonly "sync-token"?: RawText;
  readonly error?: RawError;
}

const preconditionElements: Readonly<Record<string, DavPrecondition>> = {
  "valid-sync-token": "validSyncToken",
  "number-of-matches-within-limits": "numberOfMatchesWithinLimits",
};

const localName = (name: string): string => name.replace(/^.+:/u, "");

const joinedFragments = (fragments: readonly RawFragment[]): string => fragments.map(String).join("");

const textOf = (node?: RawText): string | null => {
  if (!node) {
    return null;
  }
  const fragments = [...listed(node._text), ...listed(node._cdata)];
  if (fragments.length === 0) {
    return null;
  }
  return joinedFragments(fragments);
};

const trimmedText = (node?: RawText): string | null => {
  const text = textOf(node);
  if (text === null) {
    return null;
  }
  return text.trim();
};

const statusCodeIn = (text: string | null): number | null => {
  if (text === null) {
    return null;
  }
  const match = /\s(\d{3})\s?/u.exec(text);
  if (!match) {
    return null;
  }
  return Number.parseInt(match[1] ?? "", 10);
};

const preconditionIn = (error?: RawError): DavPrecondition | null => {
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

const propstatStatus = (propstats: readonly RawPropstat[]): number | null => {
  for (const propstat of propstats) {
    const code = statusCodeIn(trimmedText(propstat.status));
    if (code !== null) {
      return code;
    }
  }
  return null;
};

const propOf = (propstats: readonly RawPropstat[]): RawProp => {
  for (const propstat of propstats) {
    if (propstat.prop) {
      return propstat.prop;
    }
  }
  return {};
};

const responseOf = (raw: RawResponse): MultistatusResponse => {
  const propstats = listed(raw.propstat);
  const prop = propOf(propstats);
  const declared = statusCodeIn(trimmedText(raw.status));
  const fromPropstat = propstatStatus(propstats);
  return {
    href: trimmedText(raw.href) ?? "",
    status: declared ?? fromPropstat ?? 0,
    etag: trimmedText(prop.getetag),
    calendarData: textOf(prop["calendar-data"]),
    precondition: preconditionIn(raw.error),
  };
};

const parsedDocument = (body: string): object =>
  xml2js(body, {
    compact: true,
    ignoreDeclaration: true,
    ignoreComment: true,
    elementNameFn: localName,
  });

const multistatusIn = (document: object): RawMultistatus | undefined =>
  Reflect.get(document, "multistatus");

const errorIn = (document: object): RawError | undefined => Reflect.get(document, "error");

const rootOf = (body: string): RawMultistatus => multistatusIn(parsedDocument(body)) ?? {};

const readMultistatus = (body: string): MultistatusDocument => {
  if (body.trim().length === 0) {
    return { syncToken: null, responses: [], precondition: null };
  }
  const root = rootOf(body);
  return {
    syncToken: trimmedText(root["sync-token"]),
    responses: listed(root.response).map((raw) => responseOf(raw)),
    precondition: preconditionIn(root.error),
  };
};

const readErrorPrecondition = (body: string): DavPrecondition | null => {
  if (body.trim().length === 0) {
    return null;
  }
  const named = preconditionIn(errorIn(parsedDocument(body)));
  if (named) {
    return named;
  }
  const document = readMultistatus(body);
  if (document.precondition) {
    return document.precondition;
  }
  const carried = document.responses.find((response) => response.precondition !== null);
  return carried?.precondition ?? null;
};

export { readErrorPrecondition, readMultistatus };
export type { MultistatusDocument, MultistatusResponse };
