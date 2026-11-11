const REGISTRATION_EMAIL_DOMAIN_MESSAGE = "Registration is limited to approved email domains";

const normalizeEmailDomain = (domain: string): string =>
  domain.trim().replace(/^@/, "").toLowerCase();

const parseRegistrationEmailDomains = (value?: string): string[] =>
  (value ?? "")
    .split(",")
    .map((domain) => normalizeEmailDomain(domain))
    .filter(Boolean);

const isRegistrationEmailAllowed = (email: string, domains: string[]): boolean => {
  if (domains.length === 0) {
    return true;
  }
  const domain = normalizeEmailDomain(email.slice(email.lastIndexOf("@") + 1));
  return domains.includes(domain);
};

export {
  REGISTRATION_EMAIL_DOMAIN_MESSAGE,
  isRegistrationEmailAllowed,
  parseRegistrationEmailDomains,
};
