import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { parseEwsConfig, ewsConnectionIdentity } from "../../../src/providers/ews/config";
import { EwsClient } from "../../../src/providers/ews/client";
import { ntlmRequest } from "../../../src/providers/ews/ntlm";
const state = vi.hoisted(() => ({ spawn: vi.fn(), resolve: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: state.spawn }));
vi.mock("../../../src/utils/safe-fetch", () => ({
  resolveConnection: state.resolve,
  createSafeFetch: () => () => { throw new Error("OAuth transport used for NTLM"); },
}));
const config = parseEwsConfig({
  serverUrl: "https://exchange.example.test/EWS/Exchange.asmx",
  auth: { type: "ntlm", username: "DOMAIN\\person", password: 'p\\a"ss:word' },
  minimumIntervalMs: 0,
});
// Node child processes use EventEmitter; the test double must match that API.
// eslint-disable-next-line unicorn/prefer-event-target
const makeChild = () => Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), kill: vi.fn() });
let child = makeChild();
let input = "";
const complete = (output: string, code = 0) => { child.stdout.write(output); child.emit("close", code); };
const tick = () => new Promise<void>((resolve) => { setTimeout(resolve, 0); });
beforeEach(() => {
  input = "";
  child = makeChild();
  child.stdin.on("data", (data) => { input += data.toString(); });
  state.spawn.mockReset().mockReturnValue(child);
  state.resolve.mockReset().mockResolvedValue({ urls: ["https://203.0.113.10/EWS/Exchange.asmx"] });
});
describe("NTLM configuration", () => {
  it("accepts configurable credentials and excludes the password from identity", () => {
    expect(config.auth.type).toBe("ntlm");
    expect(ewsConnectionIdentity(parseEwsConfig({ ...config, auth: { ...config.auth, password: "new" } }))).toBe(ewsConnectionIdentity(config));
    expect(ewsConnectionIdentity(parseEwsConfig({ ...config, auth: { ...config.auth, username: "other" } }))).not.toBe(ewsConnectionIdentity(config));
  });
  it.each(["person:password", "person\nheader", "person\u0000"])("rejects unsafe usernames", (username) => {
    expect(() => parseEwsConfig({ ...config, auth: { ...config.auth, username } })).toThrow();
  });
  it.each(["", "secret\r\nurl=x"])("rejects invalid passwords", (password) => {
    expect(() => parseEwsConfig({ ...config, auth: { ...config.auth, password } })).toThrow();
  });
});
describe("NTLM transport", () => {
  it("pins DNS and sends escaped secrets and SOAP only over stdin", async () => {
    const request = ntlmRequest(config, { SOAPAction: "action" }, '<soap>\n"test"</soap>');
    await tick();
    const [binary, args, options] = state.spawn.mock.calls[0] ?? [];
    expect(binary).toBe("curl");
    expect(args).toContain("--ntlm");
    expect(args).toContain("exchange.example.test:443:203.0.113.10");
    expect(args[0]).toBe("--disable");
    for (const flag of ["--location", "--retry", "--insecure", "--basic"]) {expect(args).not.toContain(flag);}
    expect(JSON.stringify(args)).not.toContain("person");
    expect(JSON.stringify(args)).not.toContain("soap");
    expect(options.stdio[2]).toBe("ignore");
    expect(input).toContain(String.raw`user = "DOMAIN\\person:p\\a\"ss:word"`);
    expect(input).toContain(String.raw`data-raw = "<soap>\n\"test\"</soap>"`);
    complete("<ok/>\n200");
    const response = await request;
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<ok/>");
  });
  it("blocks unsafe destinations before starting curl", async () => {
    state.resolve.mockRejectedValue(new Error("Private address"));
    await expect(ntlmRequest(config, {}, "body")).rejects.toThrow("Private address");
    expect(state.spawn).not.toHaveBeenCalled();
  });
  it("cancels an active subprocess", async () => {
    const controller = new AbortController();
    const request = ntlmRequest(config, {}, "body", { safeFetchOptions: { signal: controller.signal } });
    const assertion = expect(request).rejects.toThrow("NtlmRequestAborted");
    await tick(); controller.abort(); await assertion;
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });
  it("limits streamed response bytes", async () => {
    const request = ntlmRequest({ ...config, maxResponseBytes: 1024 }, {}, "body");
    const assertion = expect(request).rejects.toThrow("ResponseLimitExceeded");
    await tick(); complete(`${"x".repeat(1025)}\n200`); await assertion;
    expect(child.kill).toHaveBeenCalled();
  });
  it("reports a sanitized transport failure", async () => {
    const request = ntlmRequest(config, {}, "body");
    const assertion = expect(request).rejects.toThrow("NtlmTransportFailure");
    await tick(); complete("", 60); await assertion;
  });
  it.each([401, 302])("rejects HTTP %s without fallback or redirect", async (status) => {
    const request = new EwsClient(config).request("FindFolder", "");
    const assertion = expect(request).rejects.toMatchObject({ status, authRequired: status === 401 });
    await tick(); complete(`Error\n${status}`); await assertion;
    expect(state.spawn).toHaveBeenCalledTimes(1);
  });
});
