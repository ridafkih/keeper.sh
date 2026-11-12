export interface EventLink {
  url: string;
  /** Provider name for a meeting link ("Zoom"), otherwise the hostname. */
  label: string;
  isMeeting: boolean;
}

interface LinkSource {
  location: string | null;
  description: string | null;
}

interface MeetingProvider {
  label: string;
  matches: (host: string, path: string) => boolean;
}

const isHostOrSubdomain = (host: string, domain: string) =>
  host === domain || host.endsWith(`.${domain}`);

const MEETING_PROVIDERS: MeetingProvider[] = [
  {
    label: "Zoom",
    matches: (host, path) =>
      (isHostOrSubdomain(host, "zoom.us") || isHostOrSubdomain(host, "zoomgov.com"))
      && /^\/(j|my|w|s|wc)\//.test(path),
  },
  { label: "Google Meet", matches: (host, path) => host === "meet.google.com" && path.length > 1 },
  {
    label: "Teams",
    matches: (host, path) =>
      (host === "teams.microsoft.com" || host === "teams.live.com")
      && /^\/(l\/meetup-join|meet)\//.test(path),
  },
  { label: "Webex", matches: (host) => isHostOrSubdomain(host, "webex.com") },
  { label: "FaceTime", matches: (host) => host === "facetime.apple.com" },
  { label: "Whereby", matches: (host, path) => host === "whereby.com" && path.length > 1 },
  { label: "Jitsi", matches: (host, path) => host === "meet.jit.si" && path.length > 1 },
  { label: "GoTo Meeting", matches: (host) => isHostOrSubdomain(host, "gotomeeting.com") || host === "meet.goto.com" },
  { label: "Chime", matches: (host) => host === "chime.aws" },
];

/** Global-flag regex: callers must reset `lastIndex` or use `matchAll`/`split`. */
export const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/g;

const TRAILING_PUNCTUATION = /[.,;:!?*]+$/;

/** Trims sentence punctuation and a closing bracket the URL never opened. */
export const trimUrl = (raw: string): string => {
  let url = raw.replace(TRAILING_PUNCTUATION, "");
  for (const [open, close] of [["(", ")"], ["[", "]"], ["{", "}"]] as const) {
    while (url.endsWith(close) && url.split(open).length < url.split(close).length) {
      url = url.slice(0, -1).replace(TRAILING_PUNCTUATION, "");
    }
  }
  return url;
};

const decodeEntities = (url: string) => url.replace(/&amp;/g, "&");

const toEventLink = (raw: string): EventLink | null => {
  let parsed: URL;
  try {
    parsed = new URL(decodeEntities(trimUrl(raw)));
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const provider = MEETING_PROVIDERS.find((candidate) => candidate.matches(host, parsed.pathname));
  return {
    url: parsed.href,
    label: provider?.label ?? host,
    isMeeting: provider !== undefined,
  };
};

/** Links in an event's location, then its description, deduplicated in that order. */
export const findEventLinks = ({ location, description }: LinkSource): EventLink[] => {
  const links: EventLink[] = [];
  const seen = new Set<string>();
  for (const text of [location, description]) {
    if (!text) continue;
    for (const match of text.matchAll(URL_PATTERN)) {
      const link = toEventLink(match[0]);
      if (!link || seen.has(link.url)) continue;
      seen.add(link.url);
      links.push(link);
    }
  }
  return links;
};

/** The link to put on a primary button: a meeting link, else a location that is just a URL. */
export const findPrimaryEventLink = (source: LinkSource): EventLink | null => {
  const links = findEventLinks(source);
  const meeting = links.find((link) => link.isMeeting);
  if (meeting) return meeting;

  const location = source.location?.trim();
  if (!location || !/^https?:\/\/\S+$/.test(location)) return null;
  return toEventLink(location);
};
