type CalendarCapability = "pull" | "push";

const GOOGLE_WRITABLE_ACCESS_ROLES: ReadonlySet<string> = new Set(["owner", "writer"]);
const CALDAV_WRITE_PRIVILEGES: ReadonlySet<string> = new Set(["all", "write", "bind"]);

const isGoogleAccessRoleWritable = (accessRole: string): boolean =>
  GOOGLE_WRITABLE_ACCESS_ROLES.has(accessRole);

const isOutlookCalendarWritable = (canEdit?: boolean): boolean => canEdit === true;

const isCalDAVPrivilegeSetWritable = (privileges: readonly string[] | null): boolean => {
  if (privileges === null) {
    return true;
  }
  return privileges.some((privilege) => CALDAV_WRITE_PRIVILEGES.has(privilege));
};

const resolveCalendarCapabilities = (writable: boolean): CalendarCapability[] => {
  if (writable) {
    return ["pull", "push"];
  }
  return ["pull"];
};

export {
  isCalDAVPrivilegeSetWritable,
  isGoogleAccessRoleWritable,
  isOutlookCalendarWritable,
  resolveCalendarCapabilities,
};
export type { CalendarCapability };
