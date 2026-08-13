import { CryptoHasher } from "bun";
import { expect, it } from "vitest";
import { CalDAVClient } from "../../../../src/providers/caldav/shared/client";

const md5 = (v: string) => new CryptoHasher("md5").update(v).digest("hex");
const XML = { "content-type": "text/xml; charset=utf-8" };
const ms = (b: string) => new Response(`<?xml version="1.0" encoding="utf-8" ?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">${b}</d:multistatus>`, { headers: XML, status: 207 });
const entry = (p: string, n: string) => `<d:response><d:href>${p}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:displayname>${n}</d:displayname><cs:getctag>c</cs:getctag><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:propstat></d:response>`;

const CALS = [["/cal/u/personal/", "Personal"], ["/cal/u/shared/", "Shared"], ["/cal/u/work/", "Work"]];

const content = (path: string) => {
  if (path === "/.well-known/caldav") return new Response("", { status: 404 });
  if (path === "/") return ms(`<d:response><d:href>/</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:current-user-principal><d:href>/principals/user/</d:href></d:current-user-principal></d:prop></d:propstat></d:response>`);
  if (path === "/principals/user/") return ms(`<d:response><d:href>/principals/user/</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><c:calendar-home-set><d:href>/cal/u/</d:href></c:calendar-home-set></d:prop></d:propstat></d:response>`);
  if (path === "/cal/u/") return ms(CALS.map(([p, n]) => entry(p!, n!)).join(""));
  return ms(`<d:response><d:href>${path}</d:href><d:propstat><d:status>HTTP/1.1 200 OK</d:status><d:prop><d:supported-report-set/></d:prop></d:propstat></d:response>`);
};

const parse = (h: string) => { const o: Record<string,string> = {}; for (const [,k,q,b] of h.matchAll(/([A-Za-z]+)=(?:"([^"]*)"|([^,\s]+))/g)) o[k!] = q ?? b ?? ""; return o; };

it("diag2", async () => {
  const seen = new Set<string>();
  let nonce = "n0"; let issued = 0;
  const log: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = new URL(String(input));
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    const method = init?.method ?? "GET";
    const chal = (stale: boolean) => new Response("401", { headers: { "www-authenticate": `Digest realm="caldav", qop="auth", nonce="${nonce}", opaque="o"${stale ? ", stale=true" : ""}` }, status: 401 });
    if (!auth.toLowerCase().startsWith("digest ")) { log.push(`${url.pathname} no-auth -> challenge ${nonce}`); return chal(false); }
    const p = parse(auth.slice(7));
    if (p.nonce !== nonce) { log.push(`${url.pathname} stale-nonce ${p.nonce} -> challenge ${nonce}`); return chal(true); }
    const key = `${p.nonce}:${p.nc}`;
    if (seen.has(key)) { issued++; nonce = `n${issued}`; log.push(`${url.pathname} REPLAY ${key} -> challenge ${nonce}`); return chal(true); }
    seen.add(key);
    const a1 = md5(`user:caldav:pw`); const a2 = md5(`${method}:${p.uri}`);
    if (md5(`${a1}:${p.nonce}:${p.nc}:${p.cnonce}:${p.qop}:${a2}`) !== p.response) { log.push(`${url.pathname} BADHASH`); return chal(false); }
    log.push(`${url.pathname} ok ${key}`);
    return content(url.pathname);
  }) as any;

  const client = new CalDAVClient({ credentials: { password: "pw", username: "user" }, serverUrl: "https://caldav.example.test" });
  for (let run = 0; run < 3; run++) {
    log.push(`--- run ${run}`);
    try { const r = await client.discoverCalendars(); log.push(`=> resolved ${r.length}`); }
    catch (e: any) { log.push(`=> rejected ${e.name}: ${e.message}`); }
  }
  globalThis.fetch = original;
  console.log(log.join("\n"));
  expect(true).toBe(true);
});
