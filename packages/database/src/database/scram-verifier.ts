import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";

const SCRAM_MECHANISM = "SCRAM-SHA-256";
const SCRAM_ITERATIONS = 4096;
const SCRAM_SALT_BYTES = 16;
const SCRAM_KEY_BYTES = 32;
const SASLPREP_INVARIANT = /^[!-~]+$/;

const sign = (key: Buffer, message: string): Buffer =>
  createHmac("sha256", key).update(message).digest();

const buildScramVerifier = (
  password: string,
  salt: Buffer = randomBytes(SCRAM_SALT_BYTES),
): string => {
  if (!SASLPREP_INVARIANT.test(password)) {
    throw new Error("A role password must be printable ASCII without spaces");
  }
  const saltedPassword = pbkdf2Sync(password, salt, SCRAM_ITERATIONS, SCRAM_KEY_BYTES, "sha256");
  const storedKey = createHash("sha256").update(sign(saltedPassword, "Client Key")).digest();
  const serverKey = sign(saltedPassword, "Server Key");
  return [
    `${SCRAM_MECHANISM}$${SCRAM_ITERATIONS}:${salt.toString("base64")}`,
    `${storedKey.toString("base64")}:${serverKey.toString("base64")}`,
  ].join("$");
};

export { buildScramVerifier };
