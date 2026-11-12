import { DAVNamespaceShort } from "tsdav";

const CURRENT_USER_PRIVILEGE_SET_PROP = `${DAVNamespaceShort.DAV}:current-user-privilege-set`;

const toKebabCase = (name: string): string =>
  name.replaceAll(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readPrivilegeNames = (privilege: unknown): string[] => {
  if (!isRecord(privilege)) {
    return [];
  }
  return Object.keys(privilege).map((name) => toKebabCase(name));
};

const readCurrentUserPrivileges = (privilegeSet: unknown): string[] | null => {
  if (!isRecord(privilegeSet) || !("privilege" in privilegeSet)) {
    return null;
  }
  const { privilege } = privilegeSet;
  if (Array.isArray(privilege)) {
    return privilege.flatMap((entry) => readPrivilegeNames(entry));
  }
  return readPrivilegeNames(privilege);
};

export { CURRENT_USER_PRIVILEGE_SET_PROP, readCurrentUserPrivileges };
