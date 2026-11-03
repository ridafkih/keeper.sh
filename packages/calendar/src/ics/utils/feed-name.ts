const LEGACY_FEED_NAME_PLACEHOLDER = "iCal Feed";

const CALENDAR_NAME_PROPERTIES = ["X-WR-CALNAME", "NAME"] as const;

const FOLDED_LINE_PATTERN = /\r?\n[ \t]/g;
const LINE_BREAK_PATTERN = /\r?\n/;
const ESCAPED_TEXT_PATTERN = /\\([\\,;nN])/g;
const WHITESPACE_RUN_PATTERN = /\s+/g;
const LEADING_WWW_PATTERN = /^www\./i;
const WEBCAL_SCHEME_PATTERN = /^webcal:\/\//i;
const ESCAPED_LINE_BREAKS = new Set(["n", "N"]);

interface FeedNames {
  name: string;
  originalName: string;
}

interface StoredFeedNames {
  name: string;
  originalName: string | null;
  url: string | null;
}

const unescapeText = (value: string): string =>
  value.replaceAll(ESCAPED_TEXT_PATTERN, (_match, character: string) => {
    if (ESCAPED_LINE_BREAKS.has(character)) {
      return " ";
    }
    return character;
  });

const findValueSeparator = (line: string): number => {
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line.charAt(index);
    if (character === "\"") {
      quoted = !quoted;
    }
    if (character === ":" && !quoted) {
      return index;
    }
  }
  return -1;
};

const readPropertyName = (line: string, separator: number): string => {
  const [name = ""] = line.slice(0, separator).split(";");
  return name.trim().toUpperCase();
};

const readCalendarProperties = (ical: string): Map<string, string> => {
  const properties = new Map<string, string>();
  let depth = 0;

  for (const line of ical.replaceAll(FOLDED_LINE_PATTERN, "").split(LINE_BREAK_PATTERN)) {
    const separator = findValueSeparator(line);
    const propertyName = readPropertyName(line, separator);

    if (separator === -1) {
      continue;
    }
    if (propertyName === "BEGIN") {
      depth += 1;
      continue;
    }
    if (propertyName === "END") {
      depth -= 1;
      continue;
    }
    if (depth === 1 && !properties.has(propertyName)) {
      properties.set(propertyName, line.slice(separator + 1));
    }
  }

  return properties;
};

const normalizeName = (value: string): string =>
  unescapeText(value).replaceAll(WHITESPACE_RUN_PATTERN, " ").trim();

const readDeclaredCalendarName = (ical: string): string | null => {
  const properties = readCalendarProperties(ical);

  for (const property of CALENDAR_NAME_PROPERTIES) {
    const name = normalizeName(properties.get(property) ?? "");
    if (name.length > 0) {
      return name;
    }
  }

  return null;
};

const describeFeedHost = (url: string): string => {
  try {
    const { hostname } = new URL(url.replace(WEBCAL_SCHEME_PATTERN, "https://"));
    return hostname.replace(LEADING_WWW_PATTERN, "") || url;
  } catch {
    return url;
  }
};

const resolveFeedName = (ical: string, url: string): string =>
  readDeclaredCalendarName(ical) ?? describeFeedHost(url);

const followsFeedName = ({ name, originalName }: StoredFeedNames): boolean =>
  name === (originalName ?? LEGACY_FEED_NAME_PLACEHOLDER);

const resolveFollowedName = (stored: StoredFeedNames, feedName: string): string => {
  if (followsFeedName(stored)) {
    return feedName;
  }
  return stored.name;
};

const resolveRefreshedFeedNames = (
  stored: StoredFeedNames,
  ical: string,
): FeedNames | null => {
  if (!stored.url) {
    return null;
  }

  const feedName = resolveFeedName(ical, stored.url);
  const name = resolveFollowedName(stored, feedName);

  if (name === stored.name && feedName === stored.originalName) {
    return null;
  }

  return { name, originalName: feedName };
};

export {
  describeFeedHost,
  readDeclaredCalendarName,
  resolveFeedName,
  resolveRefreshedFeedNames,
};
export type { FeedNames, StoredFeedNames };
