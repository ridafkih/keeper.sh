const monthYearFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function formatMonthYear(isoDate: string): string {
  return monthYearFormatter.format(new Date(isoDate));
}

export interface PageMetadata {
  path: string;
  updatedAt: string;
}

export const privacyPageMetadata: PageMetadata = {
  path: "/privacy",
  updatedAt: "2025-12-01",
};

export const termsPageMetadata: PageMetadata = {
  path: "/terms",
  updatedAt: "2025-12-01",
};

