import type { Socket } from "./types";

const connections = new Map<string, Set<Socket>>();
const pingIntervals = new WeakMap<Socket, ReturnType<typeof setInterval>>();

export { connections, pingIntervals };
