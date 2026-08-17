const HOSTED_DOCS_BASE_URL = "https://www.keeper.sh/docs";

export function hostedDocsUrl(slug: string): string {
  return `${HOSTED_DOCS_BASE_URL}/${slug}`;
}
