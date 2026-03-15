import fs from "node:fs/promises";
import path from "node:path";
import { parseHTML } from "linkedom";
import type { ViteAssets, ViteScript } from "@/lib/router-context";
import { clientDistDirectory } from "./paths";

interface ManifestChunk {
  file: string;
  imports?: string[];
  isDynamicEntry?: boolean;
}

type ViteManifest = Record<string, ManifestChunk>;

function extractScripts(parent: Element): ViteScript[] {
  return Array.from(parent.querySelectorAll("script")).map((script) => {
    const result: ViteScript = {};
    const src = script.getAttribute("src");
    const content = script.textContent?.trim();

    if (src) result.src = src;
    if (content) result.content = content;

    return result;
  });
}

async function readStylesheetContents(hrefs: string[]): Promise<string[]> {
  const results: string[] = [];

  for (const href of hrefs) {
    const filePath = path.join(clientDistDirectory, href);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      results.push(content);
    } catch {
      // If we can't read it, skip inlining — it'll stay as a <link>
    }
  }

  return results;
}

function collectTransitiveImports(manifest: ViteManifest, entryKey: string): string[] {
  const visited = new Set<string>();
  const files: string[] = [];

  function walk(key: string) {
    if (visited.has(key)) return;
    visited.add(key);

    const chunk = manifest[key];
    if (chunk == null) return;

    files.push(`/${chunk.file}`);

    for (const imp of chunk.imports ?? []) {
      walk(imp);
    }
  }

  walk(entryKey);
  return files;
}

async function readManifestPreloads(): Promise<string[]> {
  const manifestPath = path.join(clientDistDirectory, ".vite", "manifest.json");
  try {
    const content = await fs.readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(content) as ViteManifest;

    const entryChunk = manifest["index.html"];
    if (entryChunk == null) return [];

    const allFiles = collectTransitiveImports(manifest, "index.html");
    // Exclude the entry script itself (it's already loaded via <script>)
    return allFiles.filter((file) => file !== `/${entryChunk.file}`);
  } catch {
    return [];
  }
}

export async function extractViteAssets(template: string, inline = false): Promise<ViteAssets> {
  const { document } = parseHTML(template);

  const head = document.querySelector("head");
  const body = document.querySelector("body");
  const root = document.getElementById("root");

  if (!head || !body || !root) {
    throw new Error("HTML template is missing required elements.");
  }

  root.remove();

  const stylesheets = Array.from(
    head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
  )
    .map((link) => link.getAttribute("href"))
    .filter((href): href is string => typeof href === "string");

  const htmlModulePreloads = Array.from(
    head.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"]'),
  )
    .map((link) => link.getAttribute("href"))
    .filter((href): href is string => typeof href === "string");

  const manifestPreloads = inline ? await readManifestPreloads() : [];
  const allPreloads = new Set([...htmlModulePreloads, ...manifestPreloads]);

  const inlineStyles = inline ? await readStylesheetContents(stylesheets) : [];

  return {
    stylesheets: inline ? [] : stylesheets,
    inlineStyles,
    modulePreloads: [...allPreloads],
    headScripts: extractScripts(head),
    bodyScripts: extractScripts(body),
  };
}
