import { getSessionDirectory } from "../../../lib/audit.js";

/** Recent sessions directory (id, name, phase, timestamps). */
export async function GET(req) {
  const url = new URL(req.url);
  const limit = url.searchParams.get("limit") || 50;
  const sessions = await getSessionDirectory(limit);
  return Response.json({ sessions });
}
