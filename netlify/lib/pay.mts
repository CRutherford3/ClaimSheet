import Stripe from "stripe"
import { claims, loadPaid, PRICES, type PaidRecord } from "./store.mts"

export function stripe() {
  const key = Netlify.env.get("STRIPE_SECRET_KEY")
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set")
  return new Stripe(key)
}

// Marks a claim paid from a completed Checkout Session. Used by both the
// success-page check and the webhook, so whichever arrives first wins and the
// other is a no-op.
export async function recordPayment(session: Stripe.Checkout.Session) {
  const cid = session.metadata?.claim_id
  const tier = session.metadata?.tier as keyof typeof PRICES | undefined
  if (!cid || !tier || session.payment_status !== "paid") return false
  if (await loadPaid(cid)) return true
  const rec: PaidRecord = { tier, amount: session.amount_total ?? PRICES[tier], session: session.id, at: Date.now() }
  await claims().setJSON(`paid/${cid}`, rec)
  return true
}
