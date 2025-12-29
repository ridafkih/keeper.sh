import env from "@keeper.sh/env/next/backend";
import { NextRequest } from "next/server";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ identifier: string }> },
) {
  if (!env.API_URL) {
    return new Response(null, { status: 501 });
  }

  const { identifier } = await params;

  const url = new URL(`/cal/${identifier}`, env.API_URL);
  const response = await fetch(url);

  if (!response.ok) {
    return new Response("Not found", { status: 404 });
  }

  const body = await response.text();
  return new Response(body, {
    headers: { "Content-Type": "text/calendar; charset=utf-8" },
  });
}
