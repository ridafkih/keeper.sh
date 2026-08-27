import { CSS_NAMED_COLORS } from "./named-colors";
import {
  GOOGLE_EVENT_COLORS,
  OUTLOOK_CALENDAR_ENUM_COLORS,
  OUTLOOK_PRESET_COLORS,
} from "./palettes";

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/;

const normalizeHexColor = (value: string): string | null => {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed.startsWith("#")) {
    return null;
  }
  let digits = trimmed.slice(1);
  if (/^[0-9a-f]{3,4}$/.test(digits)) {
    digits = digits.slice(0, 3).replaceAll(/[0-9a-f]/gu, "$&$&");
  } else if (/^[0-9a-f]{8}$/.test(digits)) {
    digits = digits.slice(0, 6);
  }
  const hex = `#${digits}`;
  if (HEX_COLOR_PATTERN.test(hex)) {
    return hex;
  }
  return null;
};

/* RFC 7986 COLOR is a CSS3 name per spec, but producers emit hex too. */
const resolveIcsColor = (value: string | undefined): string | undefined => {
  if (!value) {
    return;
  }
  const trimmed = value.trim();
  return normalizeHexColor(trimmed) ?? CSS_NAMED_COLORS[trimmed.toLowerCase()];
};

const resolveGoogleEventColor = (colorId: string | undefined): string | undefined => {
  if (!colorId) {
    return;
  }
  return GOOGLE_EVENT_COLORS[colorId];
};

const resolveGoogleCalendarColor = (backgroundColor: string | undefined): string | null => {
  if (!backgroundColor) {
    return null;
  }
  return normalizeHexColor(backgroundColor);
};

const resolveOutlookCategoryColor = (
  preset: string | null | undefined,
): string | undefined => {
  if (!preset) {
    return;
  }
  return OUTLOOK_PRESET_COLORS[preset];
};

const resolveOutlookCalendarColor = (
  hexColor: string | undefined,
  colorName: string | undefined,
): string | null => {
  if (hexColor) {
    const normalized = normalizeHexColor(hexColor);
    if (normalized) {
      return normalized;
    }
  }
  return (colorName && OUTLOOK_CALENDAR_ENUM_COLORS[colorName]) || null;
};

const resolveCalDAVCalendarColor = (calendarColor: unknown): string | null => {
  if (typeof calendarColor !== "string") {
    return null;
  }
  return resolveIcsColor(calendarColor) ?? null;
};

export {
  normalizeHexColor,
  resolveCalDAVCalendarColor,
  resolveGoogleCalendarColor,
  resolveGoogleEventColor,
  resolveIcsColor,
  resolveOutlookCalendarColor,
  resolveOutlookCategoryColor,
};
