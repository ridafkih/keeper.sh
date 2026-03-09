import type { TemplateSegments } from "./types";

const rootStreamPlaceholder = "__KEEPER_SSR_STREAM__";
const rootElementPattern = /<div\s+id=(["'])root\1(?:\s[^>]*)?><\/div>/i;

function extractTemplateSegments(template: string): TemplateSegments {
  const rootElementMatch = template.match(rootElementPattern);
  if (!rootElementMatch) {
    throw new Error("Root container #root is missing from HTML template.");
  }

  const rootElement = rootElementMatch[0];
  const rootWithPlaceholder = rootElement.replace(
    "</div>",
    `${rootStreamPlaceholder}</div>`,
  );
  const serialized = template.replace(rootElementPattern, rootWithPlaceholder);
  const markerIndex = serialized.indexOf(rootStreamPlaceholder);

  if (markerIndex === -1) {
    throw new Error("Failed to place SSR stream placeholder in template.");
  }

  return {
    prefix: serialized.slice(0, markerIndex),
    suffix: serialized.slice(markerIndex + rootStreamPlaceholder.length),
  };
}

function mergeHtmlStream(
  appBody: ReadableStream<Uint8Array> | null,
  templateSegments: TemplateSegments,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const prefixChunk = encoder.encode(templateSegments.prefix);
  const suffixChunk = encoder.encode(templateSegments.suffix);

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(prefixChunk);

      if (appBody) {
        const appReader = appBody.getReader();
        try {
          while (true) {
            const chunk = await appReader.read();
            if (chunk.done) {
              break;
            }

            const chunkCopy = new Uint8Array(chunk.value.byteLength);
            chunkCopy.set(chunk.value);
            controller.enqueue(chunkCopy);
          }
        } finally {
          appReader.releaseLock();
        }
      }

      controller.enqueue(suffixChunk);
      controller.close();
    },
  });
}

const securityHeaders: Record<string, string> = {
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "strict-origin-when-cross-origin",
};

export function buildHtmlResponse(routerResponse: Response, template: string): Response {
  const templateSegments = extractTemplateSegments(template);
  const responseStream = mergeHtmlStream(routerResponse.body, templateSegments);
  const headers = new Headers(routerResponse.headers);
  headers.delete("content-length");
  headers.set("content-type", "text/html; charset=UTF-8");

  for (const [key, value] of Object.entries(securityHeaders)) {
    headers.set(key, value);
  }

  return new Response(responseStream, {
    headers,
    status: routerResponse.status,
  });
}
