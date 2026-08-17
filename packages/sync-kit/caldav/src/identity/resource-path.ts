const decodedOnce = (pathname: string): string => {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
};

const collapsedSlashes = (pathname: string): string => pathname.replaceAll(/\/{2,}/gu, "/");

const normalizeResourcePath = (href: string, base: string): string => {
  const resolved = URL.parse(href, base);
  if (!resolved) {
    return collapsedSlashes(decodedOnce(href));
  }
  return collapsedSlashes(decodedOnce(resolved.pathname));
};

const absoluteUrl = (base: string, path: string): string => {
  const resolved = URL.parse(path, base);
  if (!resolved) {
    return `${base}${path}`;
  }
  return resolved.toString();
};

export { absoluteUrl, normalizeResourcePath };
