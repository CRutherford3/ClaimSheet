import type { Config } from "@netlify/functions"
import { claims, fail, json, loadClaim, loadPaid, newId, sanitize, tierFor, validId, PRICES } from "../lib/store.mts"

// POST /api/claim          create a new claim, returns { id }
// GET  /api/claim?c=ID     load a claim plus its paid status
// PUT  /api/claim?c=ID     save the whole claim (autosave from the app)
export default async (req: Request) => {
  const id = new URL(req.url).searchParams.get("c")

  if (req.method === "POST") {
    const newClaimId = newId()
    const claim = sanitize(newClaimId, await req.json().catch(() => ({})), null)
    await claims().setJSON(`claim/${newClaimId}`, claim)
    return json({ id: newClaimId, claim, paid: false, price: PRICES[tierFor(claim)] })
  }

  if (!validId(id)) return fail("Missing or invalid claim link", 400)
  const existing = await loadClaim(id)
  if (!existing) return fail("Claim not found", 404)

  if (req.method === "GET") {
    const paid = await loadPaid(id)
    return json({ claim: existing, paid: !!paid, price: PRICES[tierFor(existing)] })
  }

  if (req.method === "PUT") {
    const text = await req.text()
    if (text.length > 1_000_000) return fail("Claim is too large", 413)
    let body: unknown
    try { body = JSON.parse(text) } catch { return fail("Bad JSON") }
    const claim = sanitize(id, body, existing)
    await claims().setJSON(`claim/${id}`, claim)
    return json({ ok: true, updated: claim.updated, price: PRICES[tierFor(claim)] })
  }

  return fail("Method not allowed", 405)
}

export const config: Config = { path: "/api/claim", method: ["GET", "POST", "PUT"] }
