import type { Socket } from "./types";

const connections = new Map<string, Set<Socket>>();
export { connections };
