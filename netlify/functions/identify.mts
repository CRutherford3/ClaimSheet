import type { Config } from "@netlify/functions"
import Anthropic from "@anthropic-ai/sdk"
import { fail, json, loadClaim, photos, validId, validPhotoId } from "../lib/store.mts"

// POST /api/identify  { c: CLAIM_ID, photos: [PHOTO_ID, ...] }  (or photo: PHOTO_ID)
// Up to 4 photos of the same item are read together, so a close-up of the
// tag or label helps it get the brand and model right.
// Looks at an uploaded item photo and suggests what it is, the brand and
// model if visible, and a rough new replacement price. Runs through Netlify
// AI Gateway, so no API key is needed once the site has a production deploy.
// Set AI_MODEL in Netlify to switch models.

const TOOL = {
  name: "record_item",
  description: "Record what household item is in the photo.",
  input_schema: {
    type: "object" as const,
    properties: {
      item: { type: "string", description: "Short plain name a homeowner would use, with the details that set the price, e.g. '65 inch LED TV', '3-piece sectional sofa with chaise, gray fabric', 'Over-the-range microwave'." },
      brand: { type: "string", description: "Brand. Use a logo, label or tag if one is visible. If there is no label but the design clearly matches a known brand's product (an Ashley sectional, a La-Z-Boy recliner, a KitchenAid stand mixer, an Apple MacBook), give that brand and set brand_is_guess to true. Empty string only if you have no reasonable idea." },
      brand_is_guess: { type: "boolean", description: "True if the brand comes from the look of the item rather than a visible logo, label or tag." },
      model: { type: "string", description: "Model number if it can be read in a photo. Otherwise the product line or collection name if you recognize it (e.g. 'Darcy' for an Ashley sofa). Never invent a model number. Empty string if unknown." },
      category: { type: "string", enum: ["Electronics", "Furniture", "Appliances", "Clothing", "Kitchenware", "Tools", "Decor", "Bedding / Linens", "Sports / Outdoor", "Toys", "Jewelry", "Books / Media", "Other"] },
      quantity: { type: "integer", description: "How many of this item are clearly shown (usually 1)." },
      price_low: { type: "number", description: "Low end of what a comparable NEW item costs at a typical US retailer today, in USD." },
      price_high: { type: "number", description: "High end of that range in USD." },
      price_typical: { type: "number", description: "Most likely replacement price for a comparable new item, in USD." },
      search_query: { type: "string", description: "A good shopping search to find this item or a like-kind replacement." },
      confidence: { type: "string", enum: ["high", "medium", "low"], description: "How sure you are about the item and brand." },
      note: { type: "string", description: "One short tip for the homeowner, e.g. 'Photograph the label on the back for the exact model.' Empty if none." },
    },
    required: ["item", "brand", "brand_is_guess", "model", "category", "quantity", "price_low", "price_high", "price_typical", "search_query", "confidence", "note"],
  },
}

export default async (req: Request) => {
  const body = await req.json().catch(() => ({}))
  const c = body?.c
  const ids: string[] = (Array.isArray(body?.photos) ? body.photos : [body?.photo]).filter(validPhotoId).slice(0, 4)
  if (!validId(c) || !ids.length) return fail("Bad request")
  if (!(await loadClaim(c))) return fail("Claim not found", 404)
  if (!Netlify.env.get("ANTHROPIC_BASE_URL") && !Netlify.env.get("ANTHROPIC_API_KEY")) return fail("Photo scan isn't turned on yet", 503)

  const images = []
  for (const id of ids) {
    const entry = await photos().getWithMetadata(`${c}/${id}`, { type: "arrayBuffer" })
    if (entry === null) continue
    const media = String(entry.metadata?.type || "image/jpeg") as "image/jpeg" | "image/png" | "image/webp"
    images.push({ type: "image" as const, source: { type: "base64" as const, media_type: media, data: Buffer.from(entry.data as ArrayBuffer).toString("base64") } })
  }
  if (!images.length) return fail("Photo not found", 404)

  const ask = (model: string) => new Anthropic().messages.create({
      model,
      max_tokens: 600,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "record_item" },
      messages: [{
        role: "user",
        content: [
          ...images,
          { type: "text", text: `${images.length > 1 ? `These ${images.length} photos all show the same item` : "This photo is"} from a homeowner listing belongings for a property insurance contents claim. Identify the main item. Read any label, tag or serial plate for the exact brand and model. If there is no label, name the brand when the design clearly matches a known brand (furniture from Ashley, La-Z-Boy, Ikea, Pottery Barn and similar is often recognizable by its style) and mark it as a guess. Never invent a model number. Price it as a comparable NEW item at a mainstream US retailer today (replacement cost, before any depreciation). If the photo shows damage, still identify the item. If the brand is a guess, the note should tell them which tag to photograph to confirm it (for furniture, the tag under the cushions or on the bottom of the frame).` },
        ],
      }],
    })


  try {
    // Sonnet is much better than Haiku at recognizing brands with no logo
    // showing (furniture especially). Falls back to Haiku if Sonnet errors.
    // Set AI_MODEL to override.
    const models = [Netlify.env.get("AI_MODEL") || "claude-sonnet-5-5", "claude-haiku-5-5"]
    let msg: Anthropic.Message | undefined, lastErr: unknown
    for (const model of models) {
      try { msg = await ask(model); break } catch (e) { lastErr = e; console.error("identify model failed", model, e) }
    }
    if (!msg) throw lastErr
    const use = msg.content.find(b => b.type === "tool_use")
    if (!use || use.type !== "tool_use") return fail("Couldn't read that photo", 502)
    const r = use.input as Record<string, any>
    const n = (v: unknown) => Math.max(0, Math.round(Number(v) || 0))
    return json({
      item: String(r.item || "").slice(0, 120), brand: String(r.brand || "").slice(0, 80), brand_is_guess: !!r.brand_is_guess, model: String(r.model || "").slice(0, 80),
      category: String(r.category || "Other"), quantity: Math.max(1, n(r.quantity)),
      price_low: n(r.price_low), price_high: n(r.price_high), price_typical: n(r.price_typical),
      search_query: String(r.search_query || r.item || "").slice(0, 150), confidence: String(r.confidence || "low"), note: String(r.note || "").slice(0, 200),
    })
  } catch (e) {
    console.error("identify failed", e)
    return fail("Photo scan is busy. Fill it in by hand or try again.", 502)
  }
}

export const config: Config = {
  path: "/api/identify",
  method: "POST",
  // Keeps one visitor from running up the AI bill.
  rateLimit: { action: "rate_limit", aggregateBy: ["ip", "domain"], windowSize: 60, windowLimit: 20 },
}
