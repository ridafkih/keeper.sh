import { resolve } from "node:path";
import type { Plugin } from "vite";
import { XMLBuilder } from "fast-xml-parser";
import { processBlogDirectory, type ProcessedBlogPost } from "./blog";

const SITE_URL = "https://www.keeper.sh";
const FEED_FILE_NAME = "rss.xml";
const FEED_TITLE = "Keeper.sh Blog";
const FEED_DESCRIPTION =
  "Product updates, engineering deep-dives, and calendar syncing tips from the Keeper.sh team.";

const xmlBuilder = new XMLBuilder({
  format: true,
  ignoreAttributes: false,
  suppressBooleanAttributes: false,
  suppressEmptyNode: true,
});

function toRfc822Date(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Blog post date "${isoDate}" is not a valid date.`);
  }

  return date.toUTCString();
}

function resolveLastBuildDate(posts: ProcessedBlogPost[]): string {
  const [first] = posts;
  if (!first) {
    throw new Error("The blog feed cannot be built without any blog posts.");
  }

  const newest = posts.reduce(
    (latest, post) =>
      post.metadata.updatedAt > latest ? post.metadata.updatedAt : latest,
    first.metadata.updatedAt,
  );

  return toRfc822Date(newest);
}

function buildFeedXml(posts: ProcessedBlogPost[]): string {
  const document = {
    "?xml": { "@_version": "1.0", "@_encoding": "UTF-8" },
    rss: {
      "@_version": "2.0",
      "@_xmlns:atom": "http://www.w3.org/2005/Atom",
      channel: {
        title: FEED_TITLE,
        link: `${SITE_URL}/blog`,
        description: FEED_DESCRIPTION,
        language: "en",
        lastBuildDate: resolveLastBuildDate(posts),
        "atom:link": {
          "@_href": `${SITE_URL}/${FEED_FILE_NAME}`,
          "@_rel": "self",
          "@_type": "application/rss+xml",
        },
        item: posts.map((post) => {
          const url = `${SITE_URL}/blog/${post.slug}`;

          return {
            title: post.metadata.title,
            link: url,
            guid: { "#text": url, "@_isPermaLink": "true" },
            description: post.metadata.description,
            pubDate: toRfc822Date(post.metadata.createdAt),
            category: post.metadata.tags,
          };
        }),
      },
    },
  };

  return String(xmlBuilder.build(document));
}

export function feedPlugin(): Plugin {
  let blogDir: string;
  let publicDir: string;

  return {
    name: "keeper-feed",
    apply: "build",

    configResolved(config) {
      blogDir = resolve(config.root, "src/content/blog");
      publicDir = config.publicDir;
    },

    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: FEED_FILE_NAME,
        source: buildFeedXml(processBlogDirectory(blogDir, publicDir)),
      });
    },
  };
}
