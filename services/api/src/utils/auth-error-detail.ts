const MAX_DESCRIPTION_LENGTH = 300;
const EMAIL_PATTERN = /[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+/g;
const TOKEN_PATTERN = /[A-Za-z0-9._~+/=-]{32,}/g;
const HTTP_BAD_REQUEST = 400;

interface AuthErrorDetail {
  code: string | null;
  description: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readText = (body: Record<string, unknown>, key: string): string | null => {
  const value = body[key];
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return value;
};

const redactSensitiveText = (text: string): string =>
  text
    .replaceAll(EMAIL_PATTERN, "[email]")
    .replaceAll(TOKEN_PATTERN, "[redacted]")
    .slice(0, MAX_DESCRIPTION_LENGTH);

const readJsonBody = async (response: Response): Promise<unknown> => {
  try {
    return await response.clone().json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
};

const readAuthErrorDetail = async (response: Response): Promise<AuthErrorDetail | null> => {
  if (response.status < HTTP_BAD_REQUEST) {
    return null;
  }
  if (!response.headers.get("content-type")?.includes("application/json")) {
    return null;
  }
  const body = await readJsonBody(response);
  if (!isRecord(body)) {
    return null;
  }
  const code = readText(body, "error") ?? readText(body, "code");
  const description = readText(body, "error_description") ?? readText(body, "message");
  if (!code && !description) {
    return null;
  }
  return {
    code,
    description: description && redactSensitiveText(description),
  };
};

export { readAuthErrorDetail, redactSensitiveText };
export type { AuthErrorDetail };
