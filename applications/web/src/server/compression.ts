import { gzipSync } from "bun";

const COMPRESSIBLE_TYPES = new Set([
  "text/html",
  "text/css",
  "text/plain",
  "text/xml",
  "text/javascript",
  "application/javascript",
  "application/json",
  "application/xml",
  "image/svg+xml",
]);

function isCompressible(contentType: string | null): boolean {
  if (!contentType) {
    return false;
  }

  const mimeType = contentType.split(";")[0].trim();
  return COMPRESSIBLE_TYPES.has(mimeType);
}

function acceptsGzip(request: Request): boolean {
  const acceptEncoding = request.headers.get("accept-encoding");
  return acceptEncoding !== null && acceptEncoding.includes("gzip");
}

export async function withCompression(
  request: Request,
  response: Response,
): Promise<Response> {
  if (!acceptsGzip(request)) {
    return response;
  }

  if (!isCompressible(response.headers.get("content-type"))) {
    return response;
  }

  const body = await response.arrayBuffer();
  if (body.byteLength < 1024) {
    return new Response(body, {
      headers: response.headers,
      status: response.status,
    });
  }

  const compressed = gzipSync(new Uint8Array(body));
  const headers = new Headers(response.headers);
  headers.set("content-encoding", "gzip");
  headers.set("content-length", compressed.byteLength.toString());

  return new Response(compressed, {
    headers,
    status: response.status,
  });
}
