import type { Fingerprint } from "@keeper.sh/sync-protocol";

const feedContentHash = (body: string): Fingerprint => ({
  kind: "fingerprint",
  value: new Bun.CryptoHasher("sha256").update(body).digest("hex"),
});

export { feedContentHash };
