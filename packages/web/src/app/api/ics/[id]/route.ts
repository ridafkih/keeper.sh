import { NextRequest } from "next/server";

const API_URL = process.env.API_URL;
if (!API_URL) {
  throw new Error("API_URL is not set");
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const response = await fetch(`${API_URL}/api/ics/${id}`, {
    method: "DELETE",
    headers: {
      Cookie: request.headers.get("Cookie") || "",
    },
  });

  const data = await response.json();
  return Response.json(data, { status: response.status });
}
