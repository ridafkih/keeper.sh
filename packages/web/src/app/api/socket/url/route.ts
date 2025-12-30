import { NextRequest } from "next/server";
import env from "@keeper.sh/env/next/backend";

export const GET = async (request: NextRequest) => {
  if (!env.WEBSOCKET_URL) {
    return new Response("WebSocket URL is not configured", {
      status: 501,
    });
  }

  const tokenUrl = new URL("/api/socket/token", env.API_URL);
  const response = await fetch(tokenUrl, { headers: request.headers });

  if (!response.ok) {
    return new Response("Failed to get socket token", {
      status: response.status,
    });
  }

  const { token } = await response.json();
  const socketUrl = new URL(env.WEBSOCKET_URL);
  socketUrl.searchParams.set("token", token);

  return Response.json({ socketUrl: socketUrl.toString() });
};
