const MAX_LOGGED_TEXT_LENGTH = 65_536;
const TRUNCATION_MARKER = "... (truncated)";

const ADDRESS_SEPARATOR = "@";
const ADDRESS_PLACEHOLDER = "[email]";
const SCHEME_SEPARATOR = "://";
const PATH_PLACEHOLDER = "/[path]";
const LABEL_SEPARATOR = ".";
const MIN_TOP_LEVEL_LABEL_LENGTH = 2;

const LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";

const TOP_LEVEL_LABEL_CHARACTERS = new Set(LETTERS);
const LOCAL_PART_CHARACTERS = new Set(`${LETTERS}${DIGITS}._%+-`);
const DOMAIN_CHARACTERS = new Set(`${LETTERS}${DIGITS}.-`);
const SCHEME_CHARACTERS = new Set(`${LETTERS}${DIGITS}+.-`);
const URL_TERMINATORS = new Set(" \t\n\r\"'<>`\\{}|^");
const AUTHORITY_TERMINATORS = ["/", "?", "#"];

const boundText = (text: string): string => {
  if (text.length <= MAX_LOGGED_TEXT_LENGTH) {
    return text;
  }
  return `${text.slice(0, MAX_LOGGED_TEXT_LENGTH)}${TRUNCATION_MARKER}`;
};

const scanBackward = (text: string, from: number, floor: number, allowed: Set<string>): number => {
  let index = from;
  while (index > floor && allowed.has(text.charAt(index - 1))) {
    index -= 1;
  }
  return index;
};

const scanForward = (text: string, from: number, accepts: (character: string) => boolean): number => {
  let index = from;
  while (index < text.length && accepts(text.charAt(index))) {
    index += 1;
  }
  return index;
};

const readAuthorityEnd = (remainder: string): number => {
  const ends = AUTHORITY_TERMINATORS
    .map((terminator) => remainder.indexOf(terminator))
    .filter((index) => index !== -1);
  return Math.min(remainder.length, ...ends);
};

const loggedUrlFor = (scheme: string, remainder: string): string => {
  const authorityEnd = readAuthorityEnd(remainder);
  const authority = remainder.slice(0, authorityEnd);
  const host = authority.slice(authority.lastIndexOf(ADDRESS_SEPARATOR) + 1);
  const rest = remainder.slice(authorityEnd);
  if (rest.length <= 1) {
    return `${scheme}${SCHEME_SEPARATOR}${host}${rest}`;
  }
  return `${scheme}${SCHEME_SEPARATOR}${host}${PATH_PLACEHOLDER}`;
};

const withoutUrlDetail = (text: string): string => {
  const parts: string[] = [];
  let cursor = 0;
  let separator = text.indexOf(SCHEME_SEPARATOR);
  while (separator !== -1) {
    const start = scanBackward(text, separator, cursor, SCHEME_CHARACTERS);
    const remainderStart = separator + SCHEME_SEPARATOR.length;
    if (start === separator) {
      parts.push(text.slice(cursor, remainderStart));
      cursor = remainderStart;
    } else {
      const end = scanForward(text, remainderStart, (character) => !URL_TERMINATORS.has(character));
      parts.push(
        text.slice(cursor, start),
        loggedUrlFor(text.slice(start, separator), text.slice(remainderStart, end)),
      );
      cursor = end;
    }
    separator = text.indexOf(SCHEME_SEPARATOR, cursor);
  }
  parts.push(text.slice(cursor));
  return parts.join("");
};

const readLeadingLetters = (label: string): number =>
  scanForward(label, 0, (character) => TOP_LEVEL_LABEL_CHARACTERS.has(character));

const readDomainLength = (candidate: string): number => {
  const labels = candidate.split(LABEL_SEPARATOR);
  const firstEmptyLabel = labels.indexOf("");
  let topLevelIndex = labels.length - 1;
  if (firstEmptyLabel !== -1) {
    topLevelIndex = Math.min(topLevelIndex, firstEmptyLabel - 1);
  }
  while (topLevelIndex >= 1) {
    const topLevelLength = readLeadingLetters(labels[topLevelIndex] ?? "");
    if (topLevelLength >= MIN_TOP_LEVEL_LABEL_LENGTH) {
      const precedingLabels = labels.slice(0, topLevelIndex).join(LABEL_SEPARATOR);
      return precedingLabels.length + LABEL_SEPARATOR.length + topLevelLength;
    }
    topLevelIndex -= 1;
  }
  return 0;
};

const withoutAddresses = (text: string): string => {
  const parts: string[] = [];
  let cursor = 0;
  let separator = text.indexOf(ADDRESS_SEPARATOR);
  while (separator !== -1) {
    const start = scanBackward(text, separator, cursor, LOCAL_PART_CHARACTERS);
    const domainStart = separator + ADDRESS_SEPARATOR.length;
    const domainEnd = scanForward(text, domainStart, (character) => DOMAIN_CHARACTERS.has(character));
    const domainLength = readDomainLength(text.slice(domainStart, domainEnd));
    if (start === separator || domainLength === 0) {
      parts.push(text.slice(cursor, domainStart));
      cursor = domainStart;
    } else {
      parts.push(text.slice(cursor, start), ADDRESS_PLACEHOLDER);
      cursor = domainStart + domainLength;
    }
    separator = text.indexOf(ADDRESS_SEPARATOR, cursor);
  }
  parts.push(text.slice(cursor));
  return parts.join("");
};

const loggedTextFor = (text: string): string =>
  withoutAddresses(withoutUrlDetail(boundText(text)));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const loggedFieldFor = <Field>(value: Field): Field => {
  if (typeof value === "string") {
    return loggedTextFor(value) as Field;
  }
  if (Array.isArray(value)) {
    return value.map((element: unknown) => loggedFieldFor(element)) as Field;
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, field]) => [key, loggedFieldFor(field)]),
    ) as Field;
  }
  return value;
};

const loggedErrorFor = (error: unknown): unknown => {
  if (typeof error === "string") {
    return loggedTextFor(error);
  }
  if (!(error instanceof Error)) {
    return error;
  }
  const message = loggedTextFor(error.message);
  if (message === error.message) {
    return error;
  }
  const logged = new Error(message);
  logged.name = error.name;
  logged.stack = error.stack?.replace(error.message, () => message);
  return logged;
};

export { loggedErrorFor, loggedFieldFor, loggedTextFor };
