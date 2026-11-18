interface RouteTemplate {
  pattern: RegExp;
  template: string;
}

const ROUTE_TEMPLATES: readonly RouteTemplate[] = [
  { pattern: /^\/api\/cal\/[^/]+$/, template: "/api/cal/:identifier" },
  { pattern: /^\/api\/auth\/reset-password\/[^/]+$/, template: "/api/auth/reset-password/:token" },
];

const loggedPathFor = (pathname: string): string => {
  const match = ROUTE_TEMPLATES.find(({ pattern }) => pattern.test(pathname));
  return match?.template ?? pathname;
};

export { loggedPathFor };
