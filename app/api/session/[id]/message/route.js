import { handleMessage } from "../../../../../lib/session.js";

export async function POST(req, { params }) {
  const { id } = await params;
  try {
    const body = await req.json();
    const text = String(body?.text ?? "");
    const out = await handleMessage(id, text);
    return Response.json(out);
  } catch (err) {
    const status = err.status || 500;
    return Response.json(
      { error: String(err.message || err), replyNow: err.replyNow },
      { status }
    );
  }
}
