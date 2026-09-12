import { publicModelName } from "../../../lib/openai.js";

export async function GET() {
  return Response.json({
    ok: true,
    model: publicModelName(),
    flow: "NEED_NAME → NEED_TIME → CHATTING → NEED_AGE → DONE",
    note: "Wait duration is user-chosen; not a fixed 180s.",
  });
}
