import { describe, expect, it } from "vitest";
import { readCurrentUserPrivileges } from "../../src/providers/caldav/shared/privileges";

describe("readCurrentUserPrivileges", () => {
  it("reads every privilege a parsed privilege set grants", () => {
    expect(readCurrentUserPrivileges({
      privilege: [{ read: {} }, { writeContent: {} }, { bind: {} }],
    })).toEqual(["read", "write-content", "bind"]);
  });

  it("reads a privilege set that grants a single privilege", () => {
    expect(readCurrentUserPrivileges({ privilege: { read: {} } })).toEqual(["read"]);
  });

  it("reports no privilege set when the server did not return one", () => {
    expect(readCurrentUserPrivileges(null)).toBeNull();
    expect(readCurrentUserPrivileges("")).toBeNull();
  });
});
