import type { Config } from "@netlify/functions"
import type Stripe from "stripe"
import { recordPayment, stripe } from "../lib/pay.mts"

// Stripe calls this after a payment. Point a webhook at
// https://YOUR-SITE/api/stripe-webhook for checkout.session.completed and
// checkout.session.async_payment_succeeded, and set STRIPE_WEBHOOK_SECRET.
export default async (req: Request) => {
  const secret = Netlify.env.get("STRIPE_WEBHOOK_SECRET")
  if (!secret) return new Response("Webhook secret not set", { status: 500 })
  const body = await req.text()
  let event: Stripe.Event
  try {
    event = await stripe().webhooks.constructEventAsync(body, req.headers.get("stripe-signature") || "", secret)
  } catch {
    return new Response("Bad signature", { status: 400 })
  }
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    await recordPayment(event.data.object as Stripe.Checkout.Session)
  }
  return new Response("ok")
}

export const config: Config = { path: "/api/stripe-webhook", method: "POST" }
