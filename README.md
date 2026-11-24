# ClaimSheet (working name)

A phone-first contents list builder for home insurance claims. Lists save to the cloud with a private link, photos upload per item, and a paid one-time packet unlocks an adjuster-ready PDF and Excel file.

## What's in here

- `public/index.html` is the whole app (one page).
- `netlify/functions/` holds the backend:
  - `claim` creates, loads and autosaves a claim (`/api/claim`)
  - `photo` uploads and serves item photos (`/api/photo`)
  - `checkout` starts Stripe Checkout (`/api/checkout`)
  - `verify` unlocks the packet when the buyer comes back from Stripe (`/api/verify`)
  - `stripe-webhook` unlocks the packet from Stripe's side (`/api/stripe-webhook`)
  - `export` builds the PDF and Excel packet, only after payment (`/api/export`)
- Data lives in Netlify Blobs (stores `claims` and `photos`). No database needed.

Prices are set in `netlify/lib/store.mts` (`PRICES`, in cents): $9 storm-ready, $49 claim, $79 for 100+ items.

## Deploy

The site deploys automatically from GitHub: every push to `main` goes live on claimsheet.io in a minute or two. The Terminal steps below are only a backup.

## Deploy from Terminal (backup)

Drag-and-drop deploys don't run functions, so use the Netlify CLI from Terminal on your Mac:

1. Install the CLI: `npm install -g netlify-cli`
2. In this folder: `netlify login`, then `netlify init` (choose "Create & configure a new project").
3. `netlify deploy --build --prod`
4. The live domain is **claimsheet.io** (set as the primary domain in Netlify).

## Stripe setup

1. Make a Stripe account and stay in **Test mode** first.
2. Netlify > Project configuration > Environment variables, add (scope: Functions):
   - `STRIPE_SECRET_KEY` = your `sk_test_...` key
   - `STRIPE_WEBHOOK_SECRET` = from step 3
3. Stripe > Developers > Webhooks > Add endpoint: `https://claimsheet.io/api/stripe-webhook`, events `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
4. Redeploy (`netlify deploy --build --prod`) so the functions pick up the keys.
5. Test with card `4242 4242 4242 4242`, any future date, any CVC.
6. When it all works, swap both values for your live keys and redeploy.

## Limits to know

- Photos are resized on the phone to 1280px before upload (about 100 to 250 KB each), up to 8 per item.
- The PDF download can be up to about 20 MB, which is roughly 100 or more photos. Very large claims may need the photo log split later.
- Anyone with a claim's private link can open it. There are no logins yet.
