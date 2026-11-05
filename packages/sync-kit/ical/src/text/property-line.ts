interface PropertyLine {
  readonly name: string;
  readonly params: string;
  readonly value: string;
}

/*
 * Indices are UTF-16 units because the caller slices the line with them; iterating code points
 * would shift every offset past an astral character.
 */
const valueSeparatorIndex = (line: string): number => {
  const scan = { quoted: false };
  for (const [position, character] of [...line].entries()) {
    if (character === '"') {
      scan.quoted = !scan.quoted;
      continue;
    }
    if (character === ":" && !scan.quoted) {
      return position;
    }
  }
  return -1;
};

const parsePropertyLine = (line: string): PropertyLine | null => {
  const separator = valueSeparatorIndex(line);
  if (separator === -1) {
    return null;
  }
  const head = line.slice(0, separator);
  const parameterStart = head.indexOf(";");
  if (parameterStart === -1) {
    return { name: head.toUpperCase(), params: "", value: line.slice(separator + 1) };
  }
  return {
    name: head.slice(0, parameterStart).toUpperCase(),
    params: head.slice(parameterStart),
    value: line.slice(separator + 1),
  };
};

const formatPropertyLine = (line: PropertyLine): string => `${line.name}${line.params}:${line.value}`;

const parameterValue = (params: string, name: string): string | null => {
  const pattern = new RegExp(`;${name}=("[^"]*"|[^;:]*)`, "iu");
  const matched = pattern.exec(params);
  if (!matched) {
    return null;
  }
  const [, value] = matched;
  if (typeof value !== "string") {
    return null;
  }
  return value.replaceAll('"', "");
};

export { formatPropertyLine, parameterValue, parsePropertyLine };
export type { PropertyLine };
