import { Suspense } from "react";
import { Header } from "@/components/header";
import { AuthFormContainer } from "@/components/auth-form";
import { ResetPasswordForm, InvalidTokenMessage } from "./form";

interface FormLoaderProps {
  searchParams: Promise<{ token?: string }>;
}

async function FormLoader({ searchParams }: FormLoaderProps) {
  const { token } = await searchParams;

  if (!token) {
    return <InvalidTokenMessage />;
  }

  return <ResetPasswordForm token={token} />;
}

interface ResetPasswordPageProps {
  searchParams: Promise<{ token?: string }>;
}

export default function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  return (
    <div className="flex flex-col flex-1">
      <Header />
      <AuthFormContainer>
        <Suspense>
          <FormLoader searchParams={searchParams} />
        </Suspense>
      </AuthFormContainer>
    </div>
  );
}
