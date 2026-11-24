import type { Config } from "@netlify/functions"
import { fail, fullStatus, loadClaim, photos, validId } from "../lib/store.mts"
import { buildPdf, buildXlsx } from "../lib/export.mts"

// GET /api/export?c=CLAIM&fmt=pdf|xlsx  builds the claim packet. Only works
// after the claim is paid, so the files can't be pulled without checkout.
export default async (req: Request) => {
  const u = new URL(req.url)
  const c = u.searchParams.get("c"), fmt = u.searchParams.get("fmt")
  if (!validId(c)) return fail("Missing claim")
  const claim = await loadClaim(c)
  if (!claim) return fail("Claim not found", 404)
  const st = await fullStatus(claim)
  if (!st.unlocked) return fail(st.owned ? "This claim needs an upgrade before the packet can be downloaded" : "This packet has not been unlocked yet", 402)

  const base = `ClaimSheet-${(claim.info.claim || claim.info.name || "packet").replace(/[^A-Za-z0-9-]+/g, "-").slice(0, 40)}`
  if (fmt === "xlsx") {
    return new Response(new Blob([await buildXlsx(claim)]).stream(), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${base}.xlsx"`,
      },
    })
  }
  if (fmt === "pdf") {
    const store = photos()
    const pdf = await buildPdf(claim, async pid => {
      const e = await store.getWithMetadata(`${c}/${pid}`, { type: "arrayBuffer" })
      return e ? { data: e.data as ArrayBuffer, type: String(e.metadata?.type || "image/jpeg") } : null
    })
    return new Response(new Blob([pdf]).stream(), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${base}.pdf"` } })
  }
  return fail("fmt must be pdf or xlsx")
}

export const config: Config = { path: "/api/export", method: "GET" }
