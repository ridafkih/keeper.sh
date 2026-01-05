import { EVENT_COLORS } from "./constants";
import type { EventColor } from "./types";

const DJB2_INITIAL_HASH = 5381;
const DJB2_MULTIPLIER = 33;
const UNSIGNED_RIGHT_SHIFT = 0;

/**
 * Hash a string using djb2 algorithm for consistent color generation
 */
// eslint-disable-next-line no-bitwise -- bitwise operations required for djb2 hash algorithm
const hashString = (str: string): number => {
  let hash = DJB2_INITIAL_HASH;
  for (let index = 0; index < str.length; index += 1) {
    // eslint-disable-next-line no-bitwise -- bitwise XOR required for djb2 hash algorithm
    hash = (hash * DJB2_MULTIPLIER) ^ (str.codePointAt(index) ?? 0);
  }
  // eslint-disable-next-line no-bitwise -- bitwise shift required for djb2 hash algorithm
  return hash >>> UNSIGNED_RIGHT_SHIFT;
};

/**
 * Generate a consistent color from a source URL
 */
export const getColorFromUrl = (url: string | undefined): EventColor => {
  if (!url) {
    return "blue";
  }
  const hash = hashString(url);
  return EVENT_COLORS[hash % EVENT_COLORS.length] ?? "blue";
};
