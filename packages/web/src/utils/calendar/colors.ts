import { EVENT_COLORS } from "./constants";
import { EventColor } from "./types";

/**
 * Hash a string using djb2 algorithm for consistent color generation
 */
const hashString = (str: string): number => {
  let hash = 5381;
  for (let index = 0; index < str.length; index++) {
    hash = (hash * 33) ^ str.charCodeAt(index);
  }
  return hash >>> 0;
};

/**
 * Generate a consistent color from a source URL
 */
export const getColorFromUrl = (url: string | undefined): EventColor => {
  if (!url) return "blue";
  const hash = hashString(url);
  return EVENT_COLORS[hash % EVENT_COLORS.length] ?? "blue";
};
