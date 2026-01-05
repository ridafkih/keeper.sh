import { Suspense } from "react";
import type { ReactNode } from "react";
import { AuthFormContainer } from "@/components/auth-form";
import { InvalidTokenMessage, ResetPasswordForm } from "./form";

interface FormLoaderProps {
  searchParams: Promise<{ token?: string }>;
}

const FormLoader = async ({ searchParams }: FormLoaderProps): Promise<ReactNode> => {
  const { token } = await searchParams;

  if (!token) {
    return <InvalidTokenMessage />;
  }

  return <ResetPasswordForm token={token} />;
};

interface ResetPasswordPageProps {
  searchParams: Promise<{ token?: string }>;
}

const ResetPasswordPage = ({ searchParams }: ResetPasswordPageProps): ReactNode => (
  <AuthFormContainer>
    <Suspense>
      <FormLoader searchParams={searchParams} />
    </Suspense>
  </AuthFormContainer>
);

export default ResetPasswordPage;
