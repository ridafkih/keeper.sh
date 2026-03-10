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

export const homePageMetadata: PageMetadata = {
  path: "/",
  updatedAt: "2026-03-09",
};

export const blogIndexMetadata: PageMetadata = {
  path: "/blog",
  updatedAt: "2026-03-09",
};

export const privacyPageMetadata: PageMetadata = {
  path: "/privacy",
  updatedAt: "2025-12-01",
};

export const termsPageMetadata: PageMetadata = {
  path: "/terms",
  updatedAt: "2025-12-01",
};

export const staticPages: PageMetadata[] = [
  homePageMetadata,
  blogIndexMetadata,
  privacyPageMetadata,
  termsPageMetadata,
];
