import { parseHTML } from "linkedom";
import type { ViteAssets, ViteScript } from "../lib/router-context";

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

export function extractViteAssets(template: string): ViteAssets {
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

  return {
    stylesheets,
    headScripts: extractScripts(head),
    bodyScripts: extractScripts(body),
  };
}
