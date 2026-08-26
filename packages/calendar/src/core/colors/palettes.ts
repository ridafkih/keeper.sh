/*
 * Google's modern UI palette, not the classic hexes colors.get returns;
 * users expect the shades Google Calendar renders.
 */
const GOOGLE_EVENT_COLORS: Record<string, string> = {
  "1": "#7986cb",
  "2": "#33b679",
  "3": "#8e24aa",
  "4": "#e67c73",
  "5": "#f6bf26",
  "6": "#f4511e",
  "7": "#039be5",
  "8": "#616161",
  "9": "#3f51b5",
  "10": "#0b8043",
  "11": "#d50000",
};

/*
 * Microsoft publishes preset names but no hexes; these are community-measured
 * Outlook 2019/365 swatches.
 */
const OUTLOOK_PRESET_COLORS: Record<string, string> = {
  preset0: "#dc626d",
  preset1: "#e8825d",
  preset2: "#ffcd8f",
  preset3: "#fdee65",
  preset4: "#52ce90",
  preset5: "#57d2da",
  preset6: "#b6d767",
  preset7: "#5ca9e5",
  preset8: "#b1aaeb",
  preset9: "#ee5fb7",
  preset10: "#c5ced1",
  preset11: "#4497a9",
  preset12: "#c3c5bb",
  preset13: "#9fadb1",
  preset14: "#8f8f8f",
  preset15: "#ac4e5e",
  preset16: "#df8e64",
  preset17: "#bc8f6f",
  preset18: "#dac257",
  preset19: "#4ca64c",
  preset20: "#4bb4b7",
  preset21: "#85b44c",
  preset22: "#4179a3",
  preset23: "#a589cb",
  preset24: "#c34e98",
};

/*
 * Fallback when calendar.hexColor is empty; unofficial approximations of the
 * OWA swatches, as the enum has no published hexes.
 */
const OUTLOOK_CALENDAR_ENUM_COLORS: Record<string, string | null> = {
  auto: null,
  lightBlue: "#71afe5",
  lightBrown: "#ca9b78",
  lightGray: "#b6b6b6",
  lightGreen: "#87d28e",
  lightOrange: "#f1a76d",
  lightPink: "#f1919e",
  lightRed: "#ee7b78",
  lightTeal: "#5fbfc1",
  lightYellow: "#fde572",
  maxColor: null,
};

export { GOOGLE_EVENT_COLORS, OUTLOOK_CALENDAR_ENUM_COLORS, OUTLOOK_PRESET_COLORS };
