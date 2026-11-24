import { getStore } from "@netlify/blobs"

// Claims are kept in one site-wide store. A claim's ID is a long random
// string that works like a private link: anyone with it can open the claim,
// so it is never listed or guessable.
export const claims = () => getStore({ name: "claims", consistency: "strong" })
export const photos = () => getStore({ name: "photos" })

export const PRICES = { ready: 900, loss: 4900, large: 7900 } // cents
export const LARGE_CLAIM_ITEMS = 100
// AI photo scans each plan includes. Typing items in by hand is always free.
export const FREE_SCANS = 10
export const SCANS = { ready: 50, loss: 200, large: 500 }
export const RANK = { ready: 1, loss: 2, large: 3 }
export type Tier = keyof typeof PRICES
const NEXT: Record<Tier, Tier | null> = { ready: "loss", loss: "large", large: null }

export type Item = {
  id: string; desc: string; brand: string; qty: number; age: number; cond: string
  paid: number; rc: number; damaged: boolean; photos: string[]
}
export type Room = { id: string; name: string; items: Item[] }
export type Claim = {
  id: string; mode: "loss" | "ready"; created: number; updated: number
  info: { name: string; address: string; carrier: string; claim: string; dol: string; cause: string }
  rooms: Room[]
}
// amount is the credit toward upgrades: the full list price of the tier owned,
// so moving up always costs exactly the difference.
export type PaidRecord = { tier: Tier; amount: number; session: string; sessions?: string[]; at: number }

export function newId(bytes = 24) {
  const b = new Uint8Array(bytes)
  crypto.getRandomValues(b)
  return Buffer.from(b).toString("base64url")
}

export const validId = (id: string | null | undefined): id is string => !!id && /^[A-Za-z0-9_-]{20,64}$/.test(id)
export const validPhotoId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{8,40}$/.test(id)

export const json = (data: unknown, status = 200) => Response.json(data, { status })
export const fail = (msg: string, status = 400) => Response.json({ error: msg }, { status })

export async function loadClaim(id: string) {
  return (await claims().get(`claim/${id}`, { type: "json" })) as Claim | null
}
export async function loadPaid(id: string) {
  return (await claims().get(`paid/${id}`, { type: "json" })) as PaidRecord | null
}

// Items that count toward the claim: all of them for a home inventory,
// only damaged ones after a loss.
export const countedItems = (c: Claim) =>
  c.rooms.flatMap(r => r.items.filter(i => c.mode === "ready" || i.damaged).map(i => ({ ...i, room: r.name, roomId: r.id })))

export const lineTotal = (i: Item) => (Number(i.rc) || 0) * (Number(i.qty) || 1)

export function tierFor(c: Claim): Tier {
  if (c.mode === "ready") return "ready"
  return countedItems(c).length > LARGE_CLAIM_ITEMS ? "large" : "loss"
}

export async function loadScans(id: string) {
  const r = (await claims().get(`scans/${id}`, { type: "json" })) as { n: number } | null
  return r?.n ?? 0
}
export async function addScan(id: string) {
  await claims().setJSON(`scans/${id}`, { n: (await loadScans(id)) + 1 })
}

// Stripe won't charge less than 50 cents.
export const dueFor = (target: Tier, paid: PaidRecord | null) => Math.max(50, PRICES[target] - (paid ? PRICES[paid.tier] : 0))

// Everything the app needs to know about what's paid for and what's next.
export function status(c: Claim, paid: PaidRecord | null, scansUsed: number) {
  const need = tierFor(c)
  const owned = paid?.tier ?? null
  const unlocked = !!owned && RANK[owned] >= RANK[need]
  // What "Get claim packet" would buy: the tier this claim needs.
  const buyTier: Tier | null = unlocked ? null : need
  // What buying more AI scans would buy: the next plan up.
  const scanTier: Tier | null = owned ? NEXT[owned] : need
  return {
    paid: unlocked, unlocked, owned, need,
    price: buyTier ? dueFor(buyTier, paid) : 0, buyTier,
    credit: owned ? PRICES[owned] : 0,
    scans: {
      used: scansUsed, limit: owned ? SCANS[owned] : FREE_SCANS,
      upgradeTier: scanTier, upgradeLimit: scanTier ? SCANS[scanTier] : 0,
      upgradePrice: scanTier ? dueFor(scanTier, paid) : 0,
    },
  }
}
export async function fullStatus(c: Claim) {
  const [paid, used] = await Promise.all([loadPaid(c.id), loadScans(c.id)])
  return status(c, paid, used)
}

// Clean up whatever the browser sends so stored claims always have the same shape.
const str = (v: unknown, max = 200) => String(v ?? "").slice(0, max)
const num = (v: unknown, min = 0, max = 10_000_000) => Math.min(max, Math.max(min, Number(v) || 0))
export function sanitize(id: string, body: any, prev: Claim | null): Claim {
  const rooms = Array.isArray(body?.rooms) ? body.rooms.slice(0, 60) : []
  return {
    id,
    mode: body?.mode === "ready" ? "ready" : "loss",
    created: prev?.created ?? Date.now(),
    updated: Date.now(),
    info: {
      name: str(body?.info?.name), address: str(body?.info?.address, 300), carrier: str(body?.info?.carrier),
      claim: str(body?.info?.claim, 80), dol: str(body?.info?.dol, 20), cause: str(body?.info?.cause),
    },
    rooms: rooms.map((r: any) => ({
      id: str(r?.id, 40), name: str(r?.name, 80),
      items: (Array.isArray(r?.items) ? r.items.slice(0, 500) : []).map((i: any) => ({
        id: str(i?.id, 40), desc: str(i?.desc), brand: str(i?.brand), qty: Math.round(num(i?.qty, 1, 9999)) || 1,
        age: num(i?.age, 0, 200), cond: str(i?.cond, 40), paid: num(i?.paid), rc: num(i?.rc),
        damaged: !!i?.damaged,
        photos: (Array.isArray(i?.photos) ? i.photos : []).filter(validPhotoId).slice(0, 8),
      })),
    })),
  }
}
