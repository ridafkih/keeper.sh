export type TestimonialSource = "reddit" | "x" | "email";

export type Testimonial = {
  quote: string;
  author: string;
  handle: string | null;
  source: TestimonialSource;
};

export const TESTIMONIAL_SOURCE_LABELS: Record<TestimonialSource, string> = {
  reddit: "Reddit",
  x: "X",
  email: "Email",
};

// Placeholders, so the section can be reviewed before real quotes exist. The
// maintainer replaces each entry with a real quote sourced from Reddit, X or
// user email. The section does not render while this array is empty.
export const TESTIMONIALS: Testimonial[] = [];
