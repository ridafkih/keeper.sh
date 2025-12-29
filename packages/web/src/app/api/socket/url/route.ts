import { NextRequest } from "next/server";
import env from "@keeper.sh/env/next/backend";

export const GET = async (request: NextRequest) => {
  if (!env.API_URL) {
    return new Response("API_URL is not configured", { status: 500 });
  }

  const apiUrl = new URL("/api/socket/token", env.API_URL);

  const response = await fetch(apiUrl.toString(), {
    headers: request.headers,
  });

  if (!response.ok) {
    return new Response("Failed to get socket token", {
      status: response.status,
    });
  }

  const { token } = await response.json();

  const host = request.headers.get("host");
  if (!host) {
    return new Response("Missing host header", { status: 400 });
  }

  const baseApiUrl = new URL(env.API_URL);
  const protocol =
    request.headers.get("x-forwarded-proto") === "https" ? "wss" : "ws";

  const socketUrl = new URL("/socket", `${protocol}://${baseApiUrl}`);
  socketUrl.port = apiUrl.port;
  socketUrl.searchParams.set("token", token);

  const socketUrlString = socketUrl.toString();

  return Response.json({ socketUrl: socketUrlString });
};
