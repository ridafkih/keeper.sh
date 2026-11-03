import { APIError, getSessionFromCtx } from "better-auth/api";
import type { GenericEndpointContext } from "better-auth";

const PASSKEY_BELONGS_TO_ANOTHER_ACCOUNT = "PASSKEY_BELONGS_TO_ANOTHER_ACCOUNT";

interface PasskeyOwner {
  userId: string;
}

interface VerifiedPasskeyAuthentication {
  ctx: GenericEndpointContext;
  verification: { authenticationInfo: { credentialID: string } };
}

const findPasskeyOwner = (
  ctx: GenericEndpointContext,
  credentialId: string,
): Promise<PasskeyOwner | null> =>
  ctx.context.adapter.findOne<PasskeyOwner>({
    model: "passkey",
    where: [{ field: "credentialID", value: credentialId }],
  });

const keepSignedInAccount = async ({
  ctx,
  verification,
}: VerifiedPasskeyAuthentication): Promise<void> => {
  const session = await getSessionFromCtx(ctx);
  if (!session) {
    return;
  }
  const owner = await findPasskeyOwner(ctx, verification.authenticationInfo.credentialID);
  if (owner?.userId === session.user.id) {
    return;
  }
  throw new APIError("FORBIDDEN", {
    code: PASSKEY_BELONGS_TO_ANOTHER_ACCOUNT,
    message: "That passkey belongs to a different account.",
  });
};

export { keepSignedInAccount };
