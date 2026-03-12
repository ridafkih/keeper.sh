import { auth } from "../../context";

const GET = async () => {
  const metadata = await auth.api.getMCPProtectedResource();
  return Response.json(metadata);
};

export { GET };
