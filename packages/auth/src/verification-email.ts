interface VerificationEmailInput {
  user: { email: string; name: string };
  url: string;
}

const VERIFICATION_EMAIL_SUBJECT = "Verify your email for Keeper.sh";
const VERIFICATION_EMAIL_TEMPLATE_ID = "email-verification";

const buildVerificationEmail = ({ user, url }: VerificationEmailInput) => ({
  subject: VERIFICATION_EMAIL_SUBJECT,
  template: {
    id: VERIFICATION_EMAIL_TEMPLATE_ID,
    variables: { name: user.name, url },
  },
  to: user.email,
});

export { buildVerificationEmail };
