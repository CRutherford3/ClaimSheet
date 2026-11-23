import type { Config } from "@netlify/functions"
import { fail, json, loadClaim, loadPaid, PRICES, tierFor, validId, countedItems } from "../lib/store.mts"
import { stripe } from "../lib/pay.mts"

const NAMES = {
  ready: "ClaimSheet home inventory packet",
  loss: "ClaimSheet claim packet",
  large: "ClaimSheet claim packet (100+ items)",
}

// POST /api/checkout  { c: CLAIM_ID }  returns { url } for Stripe Checkout.
// The price is worked out here from the saved claim, never taken from the browser.
export default async (req: Request) => {
  const { c } = await req.json().catch(() => ({}))
  if (!validId(c)) return fail("Missing claim")
  const claim = await loadClaim(c)
  if (!claim) return fail("Claim not found", 404)
  if (await loadPaid(c)) return json({ alreadyPaid: true })
  if (!countedItems(claim).length) return fail("Add at least one item first")

  const tier = tierFor(claim)
  const origin = new URL(req.url).origin
  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: PRICES[tier], product_data: { name: NAMES[tier] } } }],
    metadata: { claim_id: c, tier },
    success_url: `${origin}/app/?c=${c}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/app/?c=${c}`,
    allow_promotion_codes: true,
  })
  return json({ url: session.url })
}

export const config: Config = { path: "/api/checkout", method: "POST" }
