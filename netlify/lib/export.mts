import ExcelJS from "exceljs"
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib"
import { countedItems, lineTotal, type Claim } from "./store.mts"

const money = (n: number) => "$" + (Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const title = (c: Claim) => (c.mode === "ready" ? "Home Contents Inventory" : "Contents Inventory / Personal Property Claim")
// Standard PDF fonts only cover basic Latin, so swap anything else out.
const safe = (s: string) => String(s ?? "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^\x20-\x7E]/g, "")

export async function buildXlsx(c: Claim) {
  const wb = new ExcelJS.Workbook()
  wb.creator = "ClaimSheet"
  const ws = wb.addWorksheet("Contents", { views: [{ state: "frozen", ySplit: 7 }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } })
  ws.addRow([title(c)]).font = { bold: true, size: 14 }
  ws.addRow(["Policyholder", c.info.name, "", "Insurance company", c.info.carrier])
  ws.addRow(["Property address", c.info.address, "", "Claim number", c.info.claim])
  ws.addRow(["Date of loss", c.info.dol, "", "Cause of loss", c.info.cause])
  ws.addRow(["Prepared", new Date().toLocaleDateString("en-US")])
  ws.addRow([])
  const head = ws.addRow(["Line", "Room", "Item", "Brand / Model", "Qty", "Age (yrs)", "Condition", "Price Paid (each)", "Replacement Cost (each)", "Total Replacement Cost", "Photos"])
  head.font = { bold: true, color: { argb: "FFFFFFFF" } }
  head.eachCell(cell => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4FD1" } } })
  const items = countedItems(c)
  const first = 8
  items.forEach((i, n) => {
    const r = ws.addRow([n + 1, i.room, i.desc, i.brand, i.qty, i.age, i.cond, i.paid, i.rc, null, i.photos.length])
    r.getCell(10).value = { formula: `E${first + n}*I${first + n}`, result: lineTotal(i) }
  })
  const last = first + items.length - 1
  const tot = ws.addRow(["", "", "", "", "", "", "", "", "Total", items.length ? { formula: `SUM(J${first}:J${last})`, result: items.reduce((a, i) => a + lineTotal(i), 0) } : 0])
  tot.font = { bold: true }
  ;["H", "I", "J"].forEach(col => (ws.getColumn(col).numFmt = '"$"#,##0.00'))
  ;[6, 14, 30, 24, 6, 9, 14, 15, 17, 18, 8].forEach((w, k) => (ws.getColumn(k + 1).width = w))
  ws.addRow([])
  ws.addRow(["Replacement cost values are the policyholder's own figures. The insurance company applies depreciation and policy terms."]).font = { italic: true, size: 9 }
  return Buffer.from(await wb.xlsx.writeBuffer())
}

type PhotoLoader = (pid: string) => Promise<{ data: ArrayBuffer; type: string } | null>

export async function buildPdf(c: Claim, loadPhoto: PhotoLoader) {
  const doc = await PDFDocument.create()
  doc.setTitle(title(c)); doc.setCreator("ClaimSheet")
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const W = 792, H = 612, M = 36 // US letter, landscape
  const blue = rgb(0.12, 0.31, 0.82), grey = rgb(0.42, 0.45, 0.52), line = rgb(0.85, 0.87, 0.92)
  const cols = [
    { h: "#", w: 26, a: "l" }, { h: "Item", w: 170, a: "l" }, { h: "Brand / Model", w: 150, a: "l" }, { h: "Qty", w: 34, a: "r" },
    { h: "Age", w: 40, a: "r" }, { h: "Condition", w: 80, a: "l" }, { h: "Paid ea.", w: 70, a: "r" }, { h: "Replace ea.", w: 75, a: "r" }, { h: "Total RC", w: 75, a: "r" },
  ]
  const fit = (s: string, f: PDFFont, size: number, w: number) => {
    s = safe(s)
    if (f.widthOfTextAtSize(s, size) <= w) return s
    while (s.length && f.widthOfTextAtSize(s + "...", size) > w) s = s.slice(0, -1)
    return s + "..."
  }
  let page!: PDFPage, y = 0
  const pages: PDFPage[] = []
  const newPage = () => {
    page = doc.addPage([W, H]); pages.push(page); y = H - M
  }
  const text = (s: string, x: number, yy: number, size = 9, f = font, color = rgb(0.08, 0.09, 0.13)) => page.drawText(safe(s), { x, y: yy, size, font: f, color })
  const tableHead = () => {
    page.drawRectangle({ x: M, y: y - 14, width: W - 2 * M, height: 16, color: blue })
    let x = M + 4
    cols.forEach(col => {
      const tw = bold.widthOfTextAtSize(col.h, 8)
      text(col.h, col.a === "r" ? x + col.w - tw - 6 : x, y - 10, 8, bold, rgb(1, 1, 1))
      x += col.w
    })
    y -= 20
  }
  const need = (h: number, room?: string) => {
    if (y - h < M + 20) { newPage(); if (room) { text(room + " (continued)", M, y - 12, 11, bold); y -= 20; tableHead() } }
  }

  // Header block
  newPage()
  text(title(c), M, y - 18, 18, bold, blue); y -= 30
  const left = [["Policyholder", c.info.name], ["Property address", c.info.address]]
  const right = c.mode === "loss"
    ? [["Insurance company", c.info.carrier], ["Claim number", c.info.claim], ["Date of loss", c.info.dol], ["Cause of loss", c.info.cause]]
    : [["Prepared", new Date().toLocaleDateString("en-US")]]
  left.forEach(([k, v], n) => { text(k, M, y - n * 14, 8, font, grey); text(fit(v || "-", font, 10, 300), M + 90, y - n * 14, 10) })
  right.forEach(([k, v], n) => { text(k, 430, y - n * 14, 8, font, grey); text(fit(v || "-", font, 10, 230), 520, y - n * 14, 10) })
  y -= Math.max(left.length, right.length) * 14 + 8
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 2, color: blue }); y -= 16

  const items = countedItems(c)
  const byRoom = c.rooms.map(r => ({ name: r.name, items: items.filter(i => i.roomId === r.id) })).filter(r => r.items.length)
  let lineNo = 0
  for (const r of byRoom) {
    need(60)
    text(r.name, M, y - 12, 11, bold); y -= 20
    tableHead()
    for (const i of r.items) {
      need(16, r.name)
      lineNo++
      const cells = [String(lineNo), i.desc, i.brand, String(i.qty), `${i.age} yr`, i.cond, money(i.paid), money(i.rc), money(lineTotal(i))]
      let x = M + 4
      cells.forEach((s, k) => {
        const col = cols[k], v = fit(s, font, 8.5, col.w - 8), tw = font.widthOfTextAtSize(v, 8.5)
        text(v, col.a === "r" ? x + col.w - tw - 6 : x, y - 10, 8.5)
        x += col.w
      })
      page.drawLine({ start: { x: M, y: y - 14 }, end: { x: W - M, y: y - 14 }, thickness: 0.5, color: line })
      y -= 16
    }
    need(18)
    const rt = money(r.items.reduce((a, i) => a + lineTotal(i), 0))
    text("Room total", M + 4, y - 10, 9, bold); text(rt, W - M - 6 - bold.widthOfTextAtSize(rt, 9), y - 10, 9, bold)
    y -= 26
  }
  need(50)
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 2, color: blue }); y -= 22
  const grand = money(items.reduce((a, i) => a + lineTotal(i), 0))
  text(`Total replacement cost (${items.length} line items)`, M, y, 12, bold)
  text(grand, W - M - bold.widthOfTextAtSize(grand, 14), y, 14, bold); y -= 18
  text("Replacement cost values are the policyholder's own figures. The insurance company applies depreciation and policy terms.", M, y, 8, font, grey)

  // Photo log: 4 across, 2 down per page
  const withPhotos = items.flatMap((i, n) => i.photos.map((p, k) => ({ p, label: `Line ${n + 1}${i.photos.length > 1 ? ` (${k + 1})` : ""}: ${i.room} - ${i.desc}` })))
  const per = 8, cw = (W - 2 * M - 3 * 12) / 4, ch = 200
  for (let s = 0; s < withPhotos.length; s += per) {
    newPage()
    text("Photo log", M, y - 16, 16, bold, blue); y -= 30
    const top = y
    for (const [n, ph] of withPhotos.slice(s, s + per).entries()) {
      const gx = M + (n % 4) * (cw + 12), gy = top - Math.floor(n / 4) * (ch + 34)
      page.drawRectangle({ x: gx, y: gy - ch, width: cw, height: ch, color: rgb(0.95, 0.96, 0.98) })
      const got = await loadPhoto(ph.p).catch(() => null)
      if (got) {
        try {
          const img = got.type.includes("png") ? await doc.embedPng(got.data) : await doc.embedJpg(got.data)
          const sc = Math.min(cw / img.width, ch / img.height)
          page.drawImage(img, { x: gx + (cw - img.width * sc) / 2, y: gy - ch + (ch - img.height * sc) / 2, width: img.width * sc, height: img.height * sc })
        } catch { text("Photo could not be read", gx + 8, gy - ch / 2, 8, font, grey) }
      } else text("Photo missing", gx + 8, gy - ch / 2, 8, font, grey)
      text(fit(ph.label, font, 8, cw), gx, gy - ch - 12, 8)
    }
  }

  pages.forEach((p, n) => p.drawText(`ClaimSheet  |  Page ${n + 1} of ${pages.length}`, { x: M, y: 18, size: 7, font, color: grey }))
  return Buffer.from(await doc.save())
}
