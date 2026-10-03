import { describe, expect, it } from "vitest";
import { withAccountDisplay as accountDisplay } from "@/utils/provider-display";
import { withAccountDisplay as sourceDisplay } from "@/provider-display";
for (const display of [accountDisplay, sourceDisplay]) {
  describe("EWS account labels", () => {
    const input = { provider: "ews", displayName: "My Exchange", email: null, accountIdentifier: "technical-hash" };
    it("uses the saved name", () => { expect(display(input).accountLabel).toBe("My Exchange"); });
    it("prefers the mailbox", () => { expect(display({ ...input, email: "user@example.test" }).accountLabel).toBe("user@example.test"); });
    it("hides technical hashes when unnamed", () => { expect(display({ ...input, displayName: null }).accountLabel).toBe("Exchange EWS"); });
  });
}
