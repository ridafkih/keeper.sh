const DATA_EXCEPTION_CLASS = "22";
const SERVER_STATE_CLASSES = new Set(["08", "25", "40", "53", "55", "57"]);

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const IDENTIFIER_KEY_DETAIL_PATTERN = new RegExp(
  `^Key \\([^()]*\\)=\\(${UUID}(?:, ${UUID})*\\) [^()]*$`,
  "i",
);
const KEY_DETAIL_PATTERN = /^Key \((?<columns>.*?)\)(?:=\(|$)/s;
const QUOTED_SPAN_PATTERN = /\s*".*"/s;
const TRAILING_VALUE_SEPARATOR = ":";

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

const loggedServerMessage = (sqlState: string | null, message: string): string => {
  if (readSqlStateClass(sqlState) !== DATA_EXCEPTION_CLASS) {
    return message;
  }
  const [condition = ""] = message.replace(QUOTED_SPAN_PATTERN, "").split(TRAILING_VALUE_SEPARATOR);
  return condition.trimEnd();
};

const loggedServerDetail = (sqlState: string | null, detail: string): string | null => {
  if (describesServerState(sqlState) || IDENTIFIER_KEY_DETAIL_PATTERN.test(detail)) {
    return detail;
  }
  const columns = KEY_DETAIL_PATTERN.exec(detail)?.groups?.columns;
  if (typeof columns === "string") {
    return `Key (${columns})`;
  }
  return null;
};

const loggedServerContext = (sqlState: string | null, context: string): string | null => {
  if (describesServerState(sqlState)) {
    return context;
  }
  return null;
};

export { loggedServerContext, loggedServerDetail, loggedServerMessage };
