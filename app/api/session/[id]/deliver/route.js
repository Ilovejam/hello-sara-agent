import { deliverIfDue } from "../../../../../lib/session.js";

/** Idempotent deliver. Zero LLM. Client may wake at dueAt; server still owns the gate. */
export async function POST(_req, { params }) {
  const { id } = await params;
  try {
    const out = await deliverIfDue(id);
    return Response.json(out);
  } catch (err) {
    const status = err.status || 500;
    return Response.json({ error: String(err.message || err) }, { status });
  }
}
