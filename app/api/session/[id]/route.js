import { getSession } from "../../../../lib/store.js";

export async function GET(_req, { params }) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return Response.json({
    session: {
      id: session.id,
      phase: session.phase,
      name: session.name,
      age: session.age,
      acceptedAt: session.acceptedAt,
      dueAt: session.dueAt,
      delayMs: session.delayMs,
      delayLabel: session.delayLabel,
      version: session.version,
    },
    pending: session.pendingAction
      ? {
          id: session.pendingAction.id,
          intent: session.pendingAction.intent,
          status: session.pendingAction.status,
        }
      : null,
    metrics: session.metrics,
  });
}
