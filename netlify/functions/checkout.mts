import type { Config } from "@netlify/functions"
import { dueFor, fail, json, loadClaim, loadPaid, PRICES, RANK, tierFor, validId, countedItems, type Tier } from "../lib/store.mts"
import { stripe } from "../lib/pay.mts"

// Stripe Managed Payments requires a tax code on every product. ClaimSheet is
// browser-based software for personal use: "SaaS - personal use".
const TAX_CODE = "txcd_10103000"

const NAMES: Record<Tier, string> = {
  ready: "ClaimSheet Storm Ready (home inventory, 50 AI scans)",
  loss: "ClaimSheet claim packet (200 AI scans)",
  large: "ClaimSheet large claim packet (100+ items, 500 AI scans)",
}

// POST /api/checkout  { c: CLAIM_ID, tier?: "ready"|"loss"|"large" }  returns { url }.
// Buys the tier this claim needs, or a higher one if asked (for more AI scans).
// If something was already paid on this claim, only the difference is charged.
// Prices are worked out here from the saved claim, never taken from the browser.
export default async (req: Request) => {
  const { c, tier: asked } = await req.json().catch(() => ({}))
  if (!validId(c)) return fail("Missing claim")
  const claim = await loadClaim(c)
  if (!claim) return fail("Claim not found", 404)
  const paid = await loadPaid(c)
  const need = tierFor(claim)
  let target: Tier = need
  if (typeof asked === "string" && asked in PRICES && RANK[asked as Tier] > RANK[target]) target = asked as Tier
  if (paid && RANK[paid.tier] >= RANK[target]) return json({ alreadyPaid: true })
  if (!paid && !countedItems(claim).length && target === need) return fail("Add at least one item first")

  const amount = dueFor(target, paid)
  const name = paid ? `Upgrade to ${NAMES[target]} (credit for ${fmt(PRICES[paid.tier])} already paid)` : NAMES[target]
  const origin = new URL(req.url).origin
  let session
  try {
    session = await stripe().checkout.sessions.create({
    mode: "payment",
    line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: amount, product_data: { name, tax_code: TAX_CODE } } }],
    metadata: { claim_id: c, tier: target, from: paid?.tier ?? "" },
    success_url: `${origin}/app/?c=${c}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/app/?c=${c}`,
    allow_promotion_codes: true,
    })
  } catch (e) {
    console.error("checkout failed", e)
    return fail("Checkout couldn't start. Please try again in a minute.", 502)
  }
  return json({ url: session.url })
}

const fmt = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`

export const config: Config = { path: "/api/checkout", method: "POST" }
