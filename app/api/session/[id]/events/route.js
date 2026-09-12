import { getAuditTrail } from "../../../../../lib/audit.js";
import { getSession } from "../../../../../lib/store.js";

/** Append-only audit trail for one session. Not LLM context. */
export async function GET(_req, { params }) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const events = await getAuditTrail(id);
  return Response.json({
    sessionId: id,
    phase: session.phase,
    name: session.name,
    age: session.age,
    dueAt: session.dueAt,
    metrics: session.metrics,
    eventCount: events.length,
    events,
  });
}
