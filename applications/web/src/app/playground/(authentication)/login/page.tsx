import { Heading1 } from "../../components/heading";
import { Copy } from "../../components/copy";
import { LinkOut } from "../../components/link-out";
import { AuthForm } from "../../compositions/auth-form/auth-form";

const LoginPage = () => (
    <div className="flex flex-col gap-8 max-w-xs mx-auto w-full">
      <div className="flex flex-col gap-8">
        <div className="flex flex-col items-center text-center">
          <Heading1>Welcome back</Heading1>
          <Copy>Sign in to your Keeper account to continue.</Copy>
        </div>
        <AuthForm variant="login" strategy="commercial" />
        <Copy className="text-center">
          No account yet?{" "}
          <LinkOut variant="inline" href="/playground/register">
            Register
          </LinkOut>
        </Copy>
      </div>
    </div>
  );

export default LoginPage;
