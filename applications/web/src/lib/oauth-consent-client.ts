import { type } from "arktype";

const publicOAuthClientSchema = type({
  "client_name?": "string",
});

const WEB_PROTOCOLS = new Set(["http:", "https:"]);

const readOAuthClientName = (payload: unknown): string | null => {
  const client = publicOAuthClientSchema(payload);
  if (client instanceof type.errors) {
    return null;
  }

  const name = client.client_name?.trim();
  if (!name) {
    return null;
  }
  return name;
};

const resolveRedirectDestination = (redirectUri: string): string | null => {
  if (!URL.canParse(redirectUri)) {
    return null;
  }

  const url = new URL(redirectUri);
  if (WEB_PROTOCOLS.has(url.protocol)) {
    return url.host;
  }
  if (url.host) {
    return `${url.protocol}//${url.host}`;
  }
  return url.protocol;
};

const buildPublicOAuthClientUrl = (clientId: string): string =>
  `/api/auth/oauth2/public-client?${new URLSearchParams({ client_id: clientId })}`;

export { buildPublicOAuthClientUrl, readOAuthClientName, resolveRedirectDestination };
