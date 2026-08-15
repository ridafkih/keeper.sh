import type { Plugin } from "vite";
import { XMLBuilder } from "fast-xml-parser";
import {
  changelogReleases,
  type ChangelogNote,
  type ChangelogRelease,
} from "../src/lib/changelog";

const SITE_URL = "https://www.keeper.sh";
const FEED_FILE_NAME = "changelog.xml";
const FEED_TITLE = "Keeper.sh Changelog";
const FEED_DESCRIPTION =
  "Every change to Keeper.sh, newest first: new features, improvements, and the bugs we fixed.";

const xmlBuilder = new XMLBuilder({
  format: true,
  ignoreAttributes: false,
  suppressBooleanAttributes: false,
  suppressEmptyNode: true,
});

function toRfc822Date(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Changelog release date "${isoDate}" is not a valid date.`);
  }

  return date.toUTCString();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function noteListHtml(label: string, notes: ChangelogNote[]): string {
  if (notes.length === 0) {
    return "";
  }

  const items = notes
    .map((note) => `<li><strong>${escapeHtml(note.area)}</strong> — ${escapeHtml(note.summary)}</li>`)
    .join("");

  return `<h3>${label}</h3><ul>${items}</ul>`;
}

function releaseHtml(release: ChangelogRelease): string {
  const features = release.features
    .map((feature) => {
      const paragraphs = [feature.summary, ...feature.body]
        .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
        .join("");
      const url = `${SITE_URL}/changelog/${feature.slug}`;
      return `<h2><a href="${url}">${escapeHtml(feature.title)}</a></h2>${paragraphs}`;
    })
    .join("");

  return [
    features,
    noteListHtml("New", release.added),
    noteListHtml("Improved", release.improved),
    noteListHtml("Fixed", release.fixed),
    `<p>${escapeHtml(release.build)}</p>`,
  ].join("");
}

function buildFeedXml(releases: ChangelogRelease[]): string {
  const [newest] = releases;
  if (!newest) {
    throw new Error("The changelog feed cannot be built without a release.");
  }

  const document = {
    "?xml": { "@_version": "1.0", "@_encoding": "UTF-8" },
    rss: {
      "@_version": "2.0",
      "@_xmlns:atom": "http://www.w3.org/2005/Atom",
      "@_xmlns:content": "http://purl.org/rss/1.0/modules/content/",
      channel: {
        title: FEED_TITLE,
        link: `${SITE_URL}/changelog`,
        description: FEED_DESCRIPTION,
        language: "en",
        lastBuildDate: toRfc822Date(newest.date),
        "atom:link": {
          "@_href": `${SITE_URL}/${FEED_FILE_NAME}`,
          "@_rel": "self",
          "@_type": "application/rss+xml",
        },
        item: releases.map((release) => {
          const url = `${SITE_URL}/changelog#release-${release.date}`;

          return {
            title: `Keeper.sh — ${release.date}`,
            link: url,
            guid: { "#text": url, "@_isPermaLink": "true" },
            description: FEED_DESCRIPTION,
            "content:encoded": releaseHtml(release),
            pubDate: toRfc822Date(release.date),
          };
        }),
      },
    },
  };

  return String(xmlBuilder.build(document));
}

export function changelogFeedPlugin(): Plugin {
  return {
    name: "keeper-changelog-feed",
    apply: "build",

    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: FEED_FILE_NAME,
        source: buildFeedXml(changelogReleases),
      });
    },
  };
}
