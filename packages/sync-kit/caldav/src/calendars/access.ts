import type { CalendarAccess } from "@keeper.sh/sync-protocol";

const writePrivileges = ["write", "write-content", "all", "bind"] as const;

const comparableName = (name: string): string => name.toLowerCase().replace(/^.+:/u, "");

const calendarAccessOf = (privileges: readonly string[]): CalendarAccess => {
  const named = privileges.map((privilege) => comparableName(privilege));
  if (named.length === 0) {
    return "readWrite";
  }
  if (writePrivileges.some((privilege) => named.includes(privilege))) {
    return "readWrite";
  }
  return "readOnly";
};

export { calendarAccessOf };
