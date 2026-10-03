import { spawn } from "node:child_process";
import { resolveConnection } from "../../utils/safe-fetch";
import type { EwsConfig, EwsRuntimeOptions } from "./config";
import { EwsError } from "./error";

// Curl keeps the NTLM challenge/response on one HTTP/1.1 connection. Never
// Put secrets in argv, a temporary file, stderr or a shell command.
const quote = (value: string): string =>
  `"${value.replaceAll('\\', String.raw`\\`).replaceAll('"', String.raw`\"`).replaceAll('\n', String.raw`\n`).replaceAll('\r', String.raw`\r`).replaceAll('	', String.raw`\t`).replaceAll('\v', String.raw`\v`)}"`;

const ntlmRequest = async (
  config: EwsConfig,
  headers: Record<string, string>,
  body: string,
  options: EwsRuntimeOptions = {},
): Promise<Response> => {
  if (config.auth.type !== "ntlm") {
    throw new EwsError("NtlmCredentialsRequired");
  }
  const timeout = config.timeoutMs ?? 30_000;
  const signals = [AbortSignal.timeout(timeout)];
  if (options.safeFetchOptions?.signal) {signals.push(options.safeFetchOptions.signal);}
  const signal = AbortSignal.any(signals);
  signal.throwIfAborted();
  const connection = await resolveConnection(config.serverUrl, {
    blockPrivateResolution: true,
    ...options.safeFetchOptions,
  });
  signal.throwIfAborted();
  const url = new URL(config.serverUrl);
  const args = [
    "--disable", "--silent", "--http1.1", "--ntlm", "--config", "-",
    "--proxy", "", "--noproxy", "*", "--globoff", "--proto", "=https",
    "--max-time", String(timeout / 1000), "--connect-timeout", String(timeout / 1000),
    "--request", "POST", "--write-out", "\n%{http_code}",
  ];
  if (connection) {
    const [pinned] = connection.urls;
    if (!pinned) {throw new EwsError("MissingPinnedAddress");}
    args.push("--resolve", `${url.hostname}:${url.port || "443"}:${new URL(pinned).hostname}`);
  }
  // No redirects, retries, ambient proxies or curlrc. Preserve TLS hostname
  // Verification while pinning the DNS address validated by Keeper.
  const input = [
    `url = ${quote(config.serverUrl)}`,
    `user = ${quote(`${config.auth.username}:${config.auth.password}`)}`,
    `data-raw = ${quote(body)}`,
    ...Object.entries(headers).map(([name, value]) => `header = ${quote(`${name}: ${value}`)}`),
    "",
  ].join("\n");
  return new Promise<Response>((resolve, reject) => {
    const process = spawn("curl", args, { stdio: ["pipe", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const abort = () => {
      if (settled) { return; }
      settled = true;
      process.kill("SIGKILL");
      reject(new EwsError("NtlmRequestAborted"));
    };
    const cleanup = () => signal.removeEventListener("abort", abort);
    const fail = (code: string) => {
      if (settled) {return;}
      settled = true;
      cleanup();
      process.kill("SIGKILL");
      reject(new EwsError(code));
    };
    signal.addEventListener("abort", abort, { once: true });
    process.on("error", () => fail("NtlmTransportUnavailable"));
    process.stdin.on("error", () => fail("NtlmTransportFailure"));
    process.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > (config.maxResponseBytes ?? 8_388_608) + 4) {
        fail("ResponseLimitExceeded");
      } else if (!settled) {chunks.push(chunk);}
    });
    process.on("close", (code) => {
      if (settled) {return;}
      if (code !== 0) {
        fail("NtlmTransportFailure");
        return;
      }
      const output = Buffer.concat(chunks);
      const trailer = output.subarray(-4).toString();
      if (!/^\n[1-5]\d{2}$/u.test(trailer)) {
        fail("InvalidNtlmResponse");
        return;
      }
      const status = Number(trailer.slice(1));
      if (status < 200) {
        fail("InvalidNtlmResponse");
        return;
      }
      settled = true;
      cleanup();
      if ([204, 205, 304].includes(status)) {
        resolve(new Response(null, { status }));
        return;
      }
      resolve(new Response(output.subarray(0, -4), { status }));
    });
    if (signal.aborted) {abort();}
    else {process.stdin.end(input);}
  });
};

export { ntlmRequest };
