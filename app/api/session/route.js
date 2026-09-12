import { createSession } from "../../../lib/session.js";

export async function POST() {
  try {
    const body = await createSession();
    return Response.json(body);
  } catch (err) {
    console.error(err);
    return Response.json(
      { error: String(err.message || err) },
      { status: 500 }
    );
  }
}
