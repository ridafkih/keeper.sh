/**
 * Stands in for the `virtual:*` content modules that `plugins/blog.ts` builds at
 * bundle time. Vitest does not run the Vite plugin, so a route that reaches one of
 * them transitively — the homepage does, through `article-library` — would fail to
 * resolve. Tests that care about real content mock the `src/lib/*` wrapper instead.
 */
export const comparePages: unknown[] = [];
export const docsPages: unknown[] = [];
export const guidesPages: unknown[] = [];
export const recipesPages: unknown[] = [];
