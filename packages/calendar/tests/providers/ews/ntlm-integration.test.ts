import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer } from "node:https";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Socket } from "node:net";
import { EwsClient } from "../../../src/providers/ews/client";
import { parseEwsConfig } from "../../../src/providers/ews/config";

// Public test-only TLS key; never used outside this loopback test server.
const cert = fileURLToPath(new URL("../../fixtures/ntlm/cert.pem", import.meta.url));
const key = fileURLToPath(new URL("../../fixtures/ntlm/key.pem", import.meta.url));
const sockets = new Set<Socket>();
const authorizedBodies: string[] = [];
const users: string[] = [];
let mode = "ntlm";
let exchanges = 0;
const challenge = Buffer.alloc(52);
challenge.write("NTLMSSP\0");
challenge.writeUInt32LE(2, 8);
challenge.writeUInt32LE(48, 16);
challenge.writeUInt32LE(0x00_88_02_01, 20);
Buffer.from("0123456789abcdef", "hex").copy(challenge, 24);
challenge.writeUInt16LE(4, 40);
challenge.writeUInt16LE(4, 42);
challenge.writeUInt32LE(48, 44);
const server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, async (request, response) => {
  exchanges++;
  if (mode === "basic") {
    response.writeHead(401, { "WWW-Authenticate": 'Basic realm="test"' });
    response.end(); return;
  }
  const authorization = request.headers.authorization ?? "";
  const token = Buffer.from(authorization.replace(/^NTLM /u, ""), "base64");
  let type = 0;
  if (token.length >= 12) { type = token.readUInt32LE(8); }
  if (type === 1) {
    sockets.add(request.socket);
    request.resume();
    response.writeHead(401, { "WWW-Authenticate": `NTLM ${challenge.toString("base64")}`, "Content-Length": "0" });
    response.end(); return;
  }
  if (type !== 3 || !sockets.has(request.socket)) {
    response.writeHead(403); response.end(); return;
  }
  const length = token.readUInt16LE(36);
  const offset = token.readUInt32LE(40);
  users.push(token.subarray(offset, offset + length).toString("utf16le"));
  let body = "";
  for await (const chunk of request) {body += chunk.toString();}
  authorizedBodies.push(body);
  response.writeHead(200, { "Content-Type": "text/xml" });
  response.end('<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types"><s:Body><m:FindFolderResponse><m:ResponseMessages><m:FindFolderResponseMessage ResponseClass="Success"><m:ResponseCode>NoError</m:ResponseCode><m:RootFolder IncludesLastItemInRange="true"><t:Folders><t:CalendarFolder><t:FolderId Id="calendar"/><t:DisplayName>Test calendar</t:DisplayName><t:EffectiveRights><t:Read>true</t:Read><t:CreateContents>true</t:CreateContents><t:Modify>true</t:Modify><t:Delete>true</t:Delete></t:EffectiveRights></t:CalendarFolder></t:Folders></m:RootFolder></m:FindFolderResponseMessage></m:ResponseMessages></m:FindFolderResponse></s:Body></s:Envelope>');
});
let endpoint = "";
beforeAll(async () => {
  vi.stubEnv("CURL_CA_BUNDLE", cert);
  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") {throw new Error("Missing test address");}
  endpoint = `https://localhost:${address.port}/EWS/Exchange.asmx`;
});
afterAll(async () => {
  vi.unstubAllEnvs();
  server.closeAllConnections();
  await new Promise<void>((resolve) => { server.close(() => resolve()); });
});
const client = (privateAllowed = true) => {
  let serverUrl = endpoint;
  if (!privateAllowed) { serverUrl = endpoint.replace("localhost", "127.0.0.1"); }
  return new EwsClient(parseEwsConfig({
  serverUrl,
  auth: { type: "ntlm", username: "DOMAIN\\person", password: 'p\\a"ss:word' },
  timeoutMs: 3000,
  minimumIntervalMs: 0,
}), { safeFetchOptions: { blockPrivateResolution: !privateAllowed } });
};
describe("real curl NTLM handshake", () => {
  it("discovers calendars over a single authenticated TLS connection", async () => {
    const calendars = await client().discoverCalendars();
    expect(calendars).toEqual([{ id: "calendar", name: "Test calendar", canRead: true, canWrite: true }]);
    expect(users).toEqual(["person"]);
    expect(authorizedBodies[0]).toContain("<m:FindFolder");
    expect(exchanges).toBe(2);
  });
  it("refuses a server offering only Basic", async () => {
    mode = "basic";
    await expect(client().discoverCalendars()).rejects.toMatchObject({ status: 401, authRequired: true });
    expect(users).toHaveLength(1);
  });
  it("blocks the loopback target when private resolution is disallowed", async () => {
    const before = exchanges;
    await expect(client(false).discoverCalendars()).rejects.toThrow("private or reserved");
    expect(exchanges).toBe(before);
  });
});
