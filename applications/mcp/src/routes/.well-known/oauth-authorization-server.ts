import { auth } from "../../context";

const GET = async () => {
  const metadata = await auth.api.getMcpOAuthConfig();
  return Response.json(metadata);
};

export { GET };
