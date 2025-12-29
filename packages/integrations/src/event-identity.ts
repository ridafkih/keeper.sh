const SUFFIX = "@keeper.sh";

export const generateEventUid = (): string => {
  return `${crypto.randomUUID()}${SUFFIX}`;
};

export const isKeeperEvent = (uid: string): boolean => uid.includes(SUFFIX);
