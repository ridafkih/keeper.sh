import { NextRequest } from "next/server";
import env from "@keeper.sh/env/next/backend";

const getBaseUrl = (request: NextRequest) => {
  if (env.API_URL) return env.API_URL;
  const protocol =
    request.headers.get("x-forwarded-proto") === "https" ? "https:" : "http:";
  return `${protocol}//${request.headers.get("host")}`;
};

const getSocketUrl = (request: NextRequest) => {
  const url = new URL("/socket", getBaseUrl(request));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url;
};

export const GET = async (request: NextRequest) => {
  const tokenUrl = new URL("/api/socket/token", getBaseUrl(request));
  const response = await fetch(tokenUrl, { headers: request.headers });

  if (!response.ok) {
    return new Response("Failed to get socket token", {
      status: response.status,
    });
  }

  const { token } = await response.json();
  const socketUrl = getSocketUrl(request);
  socketUrl.searchParams.set("token", token);

  return Response.json({ socketUrl: socketUrl.toString() });
};
