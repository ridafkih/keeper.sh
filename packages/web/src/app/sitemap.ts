import type { MetadataRoute } from "next";
import { SITE_URL } from "@/config/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      changeFrequency: "weekly",
      lastModified: new Date(),
      priority: 1,
      url: SITE_URL,
    },
    {
      changeFrequency: "monthly",
      lastModified: new Date(),
      priority: 0.8,
      url: `${SITE_URL}/features`,
    },
    {
      changeFrequency: "monthly",
      lastModified: new Date(),
      priority: 0.8,
      url: `${SITE_URL}/pricing`,
    },
    {
      changeFrequency: "yearly",
      lastModified: new Date(),
      priority: 0.3,
      url: `${SITE_URL}/privacy`,
    },
    {
      changeFrequency: "yearly",
      lastModified: new Date(),
      priority: 0.3,
      url: `${SITE_URL}/terms`,
    },
    {
      changeFrequency: "yearly",
      lastModified: new Date(),
      priority: 0.5,
      url: `${SITE_URL}/login`,
    },
    {
      changeFrequency: "yearly",
      lastModified: new Date(),
      priority: 0.5,
      url: `${SITE_URL}/register`,
    },
  ];
}
