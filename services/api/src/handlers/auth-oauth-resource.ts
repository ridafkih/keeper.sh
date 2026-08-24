interface PrepareOAuthTokenRequestInput {
  mcpPublicUrl?: string;
  pathname: string;
  request: Request;
}

type PreparedOAuthTokenRequest =
  | {
    mcpResourceInjected: true;
    mcpResourceUrl: string;
    request: Request;
  }
  | {
    mcpResourceInjected: false;
    request: Request;
  };

const TOKEN_ENDPOINT_PATH = "/api/auth/oauth2/token";
const FORM_URLENCODED_MEDIA_TYPE = "application/x-www-form-urlencoded";
const TOKEN_GRANT_TYPES = new Set(["authorization_code", "refresh_token"]);

const isTokenEndpointRequest = (pathname: string, request: Request): boolean =>
  pathname === TOKEN_ENDPOINT_PATH && request.method === "POST";

const isFormRequest = (request: Request): boolean => {
  const contentType = request.headers.get("content-type");
  if (!contentType) {
    return false;
  }

  return contentType.toLowerCase().includes(FORM_URLENCODED_MEDIA_TYPE);
};

const prepareOAuthTokenRequest = async ({
  mcpPublicUrl,
  pathname,
  request,
}: PrepareOAuthTokenRequestInput): Promise<PreparedOAuthTokenRequest> => {
  if (!mcpPublicUrl) {
    return {
      mcpResourceInjected: false,
      request,
    };
  }

  if (!isTokenEndpointRequest(pathname, request)) {
    return {
      mcpResourceInjected: false,
      request,
    };
  }

  if (!isFormRequest(request)) {
    return {
      mcpResourceInjected: false,
      request,
    };
  }

  const body = await request.clone().text();

  if (body.length === 0) {
    return {
      mcpResourceInjected: false,
      request,
    };
  }

  const searchParams = new URLSearchParams(body);

  if (searchParams.has("resource")) {
    return {
      mcpResourceInjected: false,
      request,
    };
  }

  const grantType = searchParams.get("grant_type");

  if (!grantType || !TOKEN_GRANT_TYPES.has(grantType)) {
    return {
      mcpResourceInjected: false,
      request,
    };
  }

  searchParams.set("resource", mcpPublicUrl);

  const headers = new Headers(request.headers);
  headers.delete("content-length");

  const requestInit: RequestInit = {
    headers,
    method: request.method,
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    requestInit.body = searchParams.toString();
  }

  return {
    mcpResourceInjected: true,
    mcpResourceUrl: mcpPublicUrl,
    request: new Request(request.url, requestInit),
  };
};

export { prepareOAuthTokenRequest };
