import type { Config } from "@netlify/functions"
import { fail, json, validId } from "../lib/store.mts"
import { recordPayment, stripe } from "../lib/pay.mts"

// GET /api/verify?c=CLAIM&session_id=cs_...  called when the buyer lands back
// on the site, so the packet unlocks right away even if the webhook is slow.
export default async (req: Request) => {
  const u = new URL(req.url)
  const c = u.searchParams.get("c"), sid = u.searchParams.get("session_id")
  if (!validId(c) || !sid || !sid.startsWith("cs_")) return fail("Bad request")
  const session = await stripe().checkout.sessions.retrieve(sid)
  if (session.metadata?.claim_id !== c) return fail("Session does not match this claim", 403)
  return json({ paid: await recordPayment(session) })
}

export const config: Config = { path: "/api/verify", method: "GET" }
