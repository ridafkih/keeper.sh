const DAV_ERROR_BODY_PATTERN = /<(?:[\w-]+:)?error\b[^>]*>(?<body>[\s\S]*?)<\/(?:[\w-]+:)?error>/iu;
const ELEMENT_NAME_PATTERN = /<(?:[\w-]+:)?(?<name>[a-z][\w-]*)\b[^>]*\/?>/giu;

const readDAVPrecondition = (body: string): string | null => {
  const errorBody = DAV_ERROR_BODY_PATTERN.exec(body)?.groups?.["body"];
  if (!errorBody) {
    return null;
  }
  for (const match of errorBody.matchAll(ELEMENT_NAME_PATTERN)) {
    const name = match.groups?.["name"];
    if (name) {
      return name.toLowerCase();
    }
  }
  return null;
};

const readBoundedText = async (response: Response, maxBytes: number): Promise<string> => {
  const reader = response.body?.getReader();
  if (!reader) {
    return "";
  }
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (received < maxBytes) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    received += value.byteLength;
  }
  await reader.cancel();
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, maxBytes));
};

const readResponsePrecondition = async (response: Response, maxBytes: number): Promise<string | null> => {
  try {
    return readDAVPrecondition(await readBoundedText(response, maxBytes));
  } catch {
    return null;
  }
};

export { readDAVPrecondition, readResponsePrecondition };
