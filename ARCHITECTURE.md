# Architecture

## Assignment mapping

PDF steps:

1. **Name** — validate before advancing  
2. **Time** — user-chosen duration (`3 minutes`, `1 hour`, …)  
3. **Age** — asked only after `dueAt`  

Verbal “fixed 180s” is covered when the user chooses `3 minutes`.

## Separation of concerns

| Layer | Responsibility |
| --- | --- |
| OpenAI | Natural language only |
| `lib/validate.js` | Name / duration / age shape |
| `lib/session.js` | Phase machine, arming `dueAt`, deliver gate |
| `lib/store.js` | Persistence (local JSON / Upstash Redis) |
| `lib/audit.js` | Ops trail — **never** fed back to the model |
| UI | Chat + countdown; resume step via `localStorage` |

## Zero-LLM deliver

On name+duration accept, the age utterance is stored on `pendingAction`.  
`POST /api/session/:id/deliver` checks `Date.now() >= dueAt` and emits that utterance with **no model call**.

## Why schemas are split

A shared onboarding JSON schema in the chat phase biased replies back to name collection.  
`nameTurn` / `chatTurn` / `ageTurn` use separate schemas.

## Observability

- Metrics: LLM calls, tokens, `latenessMs`  
- Audit: `GET /api/session/:id/events`, `GET /api/sessions`  
