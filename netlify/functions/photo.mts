import type { Config, Context } from "@netlify/functions"
import { fail, json, loadClaim, newId, photos, validId, validPhotoId } from "../lib/store.mts"

const MAX_BYTES = 4 * 1024 * 1024

// POST /api/photo?c=CLAIM          body: image/jpeg bytes, returns { id }
// GET  /api/photo/CLAIM/PHOTO      serves the photo (only with the claim's private ID)
export default async (req: Request, context: Context) => {
  if (req.method === "POST") {
    const cid = new URL(req.url).searchParams.get("c")
    if (!validId(cid) || !(await loadClaim(cid))) return fail("Claim not found", 404)
    const type = req.headers.get("content-type") || ""
    if (!/^image\/(jpeg|png|webp)$/.test(type)) return fail("Photos must be JPEG, PNG or WebP")
    const buf = await req.arrayBuffer()
    if (!buf.byteLength) return fail("Empty photo")
    if (buf.byteLength > MAX_BYTES) return fail("Photo is too large", 413)
    const pid = newId(12)
    await photos().set(`${cid}/${pid}`, buf, { metadata: { type } })
    return json({ id: pid })
  }

  if (req.method === "GET") {
    const { cid, pid } = context.params
    if (!validId(cid) || !validPhotoId(pid)) return fail("Not found", 404)
    const entry = await photos().getWithMetadata(`${cid}/${pid}`, { type: "arrayBuffer" })
    if (entry === null) return fail("Not found", 404)
    return new Response(entry.data as ArrayBuffer, {
      headers: { "content-type": String(entry.metadata?.type || "image/jpeg"), "cache-control": "private, max-age=31536000, immutable" },
    })
  }

  return fail("Method not allowed", 405)
}

export const config: Config = { path: ["/api/photo", "/api/photo/:cid/:pid"], method: ["GET", "POST"] }
