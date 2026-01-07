export const hueToOklch = (hue: number): string => `oklch(0.75 0.125 ${hue})`;

export const hueToOklchWithLightness = (hue: number, lightness: number): string =>
  `oklch(${lightness} 0.125 ${hue})`;

export const hueToOklchWithChroma = (hue: number, chroma: number): string =>
  `oklch(0.75 ${chroma} ${hue})`;

export const createOklchColor = (
  hue: number,
  lightness = 0.75,
  chroma = 0.125
): string => `oklch(${lightness} ${chroma} ${hue})`;

export const isValidHue = (hue: number): boolean => hue >= 0 && hue < 360;

export const normalizeHue = (hue: number): number => ((hue % 360) + 360) % 360;

export const huesToColors = (hues: number[]): string[] => {
  const colors: string[] = [];
  for (const hue of hues) {
    colors.push(hueToOklch(hue));
  }
  return colors;
};

export const uniqueColors = (colors: string[]): string[] => {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const color of colors) {
    if (seen.has(color)) continue;
    seen.add(color);
    unique.push(color);
  }
  return unique;
};
