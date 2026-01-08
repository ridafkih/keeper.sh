import { ArrowLeft } from "lucide-react";
import { Heading1 } from "../../components/heading";
import { Copy } from "../../components/copy";
import { IconButtonLink } from "../../components/icon-button-link";
import { LinkOut } from "../../components/link-out";
import { AuthForm } from "../../compositions/auth-form/auth-form";

const RegisterPage = () => (
    <div className="flex flex-col gap-8 max-w-xs mx-auto w-full">
      <IconButtonLink icon={ArrowLeft} variant="outline" href="/playground" />
      <div className="flex flex-col gap-8">
        <div className="flex flex-col items-center text-center">
          <Heading1>Create an account</Heading1>
          <Copy>Get started with Keeper to sync your calendars.</Copy>
        </div>
        <AuthForm variant="register" strategy="commercial" />
        <Copy className="text-center">
          Already have an account?{" "}
          <LinkOut variant="inline" href="/playground/login">
            Sign in
          </LinkOut>
        </Copy>
      </div>
    </div>
  );

export default RegisterPage;
