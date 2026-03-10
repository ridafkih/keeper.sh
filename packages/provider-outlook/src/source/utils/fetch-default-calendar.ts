import { MICROSOFT_GRAPH_API } from "../../shared/api";

const fetchDefaultCalendarId = async (accessToken: string): Promise<string | null> => {
  const response = await fetch(`${MICROSOFT_GRAPH_API}/me/calendar?$select=id`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) return null;

  const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("id" in body)) return null;
  if (typeof body.id !== "string") return null;

  return body.id;
};

export { fetchDefaultCalendarId };
