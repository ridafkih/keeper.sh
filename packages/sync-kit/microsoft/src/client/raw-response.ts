type ReadBody =
  | { readonly kind: "json"; readonly value: unknown }
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "empty" };

interface HeldResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: ReadBody;
}

const jsonBody = (text: string): ReadBody => {
  try {
    return { kind: "json", value: JSON.parse(text) };
  } catch {
    return { kind: "text", value: text };
  }
};

const readBodyOf = async (response: Response): Promise<ReadBody> => {
  if (response.body === null) {
    return { kind: "empty" };
  }
  const text = await response.text();
  if (text.length === 0) {
    return { kind: "empty" };
  }
  return jsonBody(text);
};

const holdResponse = async (response: Response): Promise<HeldResponse> => ({
  status: response.status,
  headers: response.headers,
  body: await readBodyOf(response),
});

const discardResponse = async (response: Response): Promise<void> => {
  const { body } = response;
  if (body === null) {
    return;
  }
  await body.cancel();
};

export { discardResponse, holdResponse };
export type { HeldResponse, ReadBody };
