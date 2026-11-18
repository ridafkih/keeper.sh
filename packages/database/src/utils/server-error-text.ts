const DATA_EXCEPTION_CLASS = "22";
const SERVER_STATE_CLASSES = new Set(["08", "25", "40", "53", "55", "57"]);

const MAX_SCANNED_LENGTH = 4096;

const VALUE_QUOTE = '"';
const TRAILING_VALUE_SEPARATOR = ":";

const KEY_PREFIX = "Key (";
const KEY_VALUES_OPENING = ")=(";
const KEY_VALUES_CLOSING = ")";
const KEY_VALUE_SEPARATOR = ", ";
const GROUPING_CHARACTERS = ["(", ")"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const readSqlStateClass = (sqlState: string | null): string | null => {
  if (sqlState === null) {
    return null;
  }
  return sqlState.slice(0, 2);
};

const describesServerState = (sqlState: string | null): boolean => {
  const sqlStateClass = readSqlStateClass(sqlState);
  return sqlStateClass !== null && SERVER_STATE_CLASSES.has(sqlStateClass);
};

const withoutQuotedSpan = (message: string): string => {
  const opening = message.indexOf(VALUE_QUOTE);
  if (opening === -1) {
    return message;
  }
  const closing = message.lastIndexOf(VALUE_QUOTE);
  const lead = message.slice(0, opening).trimEnd();
  if (closing === opening) {
    return lead;
  }
  return `${lead}${message.slice(closing + 1)}`;
};

const loggedServerMessage = (sqlState: string | null, message: string): string => {
  if (readSqlStateClass(sqlState) !== DATA_EXCEPTION_CLASS) {
    return message;
  }
  const scanned = message.slice(0, MAX_SCANNED_LENGTH);
  const [condition = ""] = withoutQuotedSpan(scanned).split(TRAILING_VALUE_SEPARATOR);
  return condition.trimEnd();
};

const hasGrouping = (text: string): boolean =>
  GROUPING_CHARACTERS.some((character) => text.includes(character));

const readKeyColumns = (detail: string): string | null => {
  if (!detail.startsWith(KEY_PREFIX)) {
    return null;
  }
  const valuesOpening = detail.indexOf(KEY_VALUES_OPENING);
  if (valuesOpening !== -1) {
    return detail.slice(KEY_PREFIX.length, valuesOpening);
  }
  if (detail.endsWith(KEY_VALUES_CLOSING)) {
    return detail.slice(KEY_PREFIX.length, -KEY_VALUES_CLOSING.length);
  }
  return null;
};

const namesOnlyIdentifiers = (detail: string, columns: string): boolean => {
  const valuesStart = KEY_PREFIX.length + columns.length + KEY_VALUES_OPENING.length;
  const valuesEnd = detail.indexOf(KEY_VALUES_CLOSING, valuesStart);
  if (valuesEnd === -1 || hasGrouping(columns) || hasGrouping(detail.slice(valuesEnd + 1))) {
    return false;
  }
  return detail
    .slice(valuesStart, valuesEnd)
    .split(KEY_VALUE_SEPARATOR)
    .every((value) => UUID_PATTERN.test(value));
};

const loggedKeyDetail = (detail: string): string | null => {
  const columns = readKeyColumns(detail);
  if (columns === null) {
    return null;
  }
  if (detail.includes(KEY_VALUES_OPENING) && namesOnlyIdentifiers(detail, columns)) {
    return detail;
  }
  return `${KEY_PREFIX}${columns}${KEY_VALUES_CLOSING}`;
};

const loggedServerDetail = (sqlState: string | null, detail: string): string | null => {
  if (describesServerState(sqlState)) {
    return detail;
  }
  return loggedKeyDetail(detail.slice(0, MAX_SCANNED_LENGTH));
};

const loggedServerContext = (sqlState: string | null, context: string): string | null => {
  if (describesServerState(sqlState)) {
    return context;
  }
  return null;
};

export { loggedServerContext, loggedServerDetail, loggedServerMessage };
