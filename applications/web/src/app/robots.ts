import type { MetadataRoute } from "next";

const robots = (): MetadataRoute.Robots => ({
  rules: [
    {
      allow: "/",
      disallow: ["/dashboard", "/api", "/verify-email", "/forgot-password"],
      userAgent: "*",
    },
  ],
  sitemap: "https://keeper.sh/sitemap.xml",
});

export default robots;
