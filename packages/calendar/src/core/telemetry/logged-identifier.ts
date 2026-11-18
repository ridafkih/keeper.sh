const LOGGED_IDENTIFIER_LENGTH = 16;

const loggedIdentifierFor = (value: string): string =>
  new Bun.CryptoHasher("sha256").update(value).digest("hex").slice(0, LOGGED_IDENTIFIER_LENGTH);

export { loggedIdentifierFor };
