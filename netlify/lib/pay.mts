import Stripe from "stripe"
import { claims, loadPaid, PRICES, RANK, type PaidRecord, type Tier } from "./store.mts"

export function stripe() {
  const key = Netlify.env.get("STRIPE_SECRET_KEY")
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set")
  // Stripe Managed Payments needs API version 2025-03-31.basil or newer; the
  // installed SDK defaults to an older one, so pin it here.
  return new Stripe(key, { apiVersion: "2025-03-31.basil" as any })
}

// Marks a claim paid (or upgraded) from a completed Checkout Session. Used by
// both the success-page check and the webhook. The record only ever moves up a
// tier, so whichever arrives first wins and the other is a no-op.
export async function recordPayment(session: Stripe.Checkout.Session) {
  const cid = session.metadata?.claim_id
  const tier = session.metadata?.tier as Tier | undefined
  if (!cid || !tier || !(tier in PRICES) || session.payment_status !== "paid") return false
  const prev = await loadPaid(cid)
  if (prev && RANK[prev.tier] >= RANK[tier]) return true
  const rec: PaidRecord = {
    tier, amount: PRICES[tier], session: session.id,
    sessions: [...(prev?.sessions ?? (prev ? [prev.session] : [])), session.id], at: Date.now(),
  }
  await claims().setJSON(`paid/${cid}`, rec)
  return true
}
