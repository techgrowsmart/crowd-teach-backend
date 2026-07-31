const express = require("express");
const router = express.Router();
const verifyToken = require("../utils/verifyToken");
const PDFDocument = require("pdfkit");
const cassandra = require("cassandra-driver");

// Cassandra client (same as subscription.js)
const cloud = { secureConnectBundle: "./secure-connect-gogrowsmart.zip" };
const authProvider = new cassandra.auth.PlainTextAuthProvider("token", process.env["ASTRA_TOKEN"]);
const client = new cassandra.Client({
  keyspace: process.env.ASTRA_DB_KEYSPACE,
  cloud,
  authProvider,
  credentials: {
    username: process.env.ASTRA_DB_USERNAME,
    password: process.env.ASTRA_DB_PASSWORD,
  },
});

function checkAdminRole(req, res, next) {
  const adminRole = req.user.role;
  if (adminRole !== "admin" && adminRole !== "superadmin" && adminRole !== "moderator") {
    return res.status(403).json({ success: false, message: "Access denied" });
  }
  next();
}

// ─── Design tokens ────────────────────────────────────────────────────────────
const BRAND_DARK   = "#0F172A"; // slate-900
const BRAND_ACCENT = "#4F46E5"; // indigo-600
const BRAND_LIGHT  = "#EEF2FF"; // indigo-50
const TEXT_PRIMARY = "#1E293B"; // slate-800
const TEXT_MUTED   = "#64748B"; // slate-500
const BORDER       = "#E2E8F0"; // slate-200
const SUCCESS_BG   = "#F0FDF4";
const SUCCESS_FG   = "#16A34A";
const PENDING_BG   = "#FFFBEB";
const PENDING_FG   = "#D97706";
const PAGE_W       = 595.28;    // A4 width  (pt)
const PAGE_H       = 841.89;    // A4 height (pt)
const MARGIN       = 48;
const CONTENT_W    = PAGE_W - MARGIN * 2;

// Helper: draw a filled rounded rectangle
function roundRect(doc, x, y, w, h, r, fill, stroke) {
  doc.roundedRect(x, y, w, h, r);
  if (fill && stroke) doc.fillAndStroke(fill, stroke);
  else if (fill)       doc.fill(fill);
  else if (stroke)     doc.stroke(stroke);
}

// Helper: horizontal rule
function hRule(doc, y, color = BORDER, lw = 0.5) {
  doc
    .save()
    .strokeColor(color)
    .lineWidth(lw)
    .moveTo(MARGIN, y)
    .lineTo(PAGE_W - MARGIN, y)
    .stroke()
    .restore();
}

// Helper: two-column row (label left, value right)
function infoRow(doc, y, label, value, opts = {}) {
  const { bold = false, labelColor = TEXT_MUTED, valueColor = TEXT_PRIMARY, size = 9.5 } = opts;
  doc
    .font("Helvetica").fontSize(size).fillColor(labelColor)
    .text(label, MARGIN, y, { width: CONTENT_W / 2 - 8 });
  doc
    .font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor(valueColor)
    .text(value, MARGIN + CONTENT_W / 2, y, { width: CONTENT_W / 2, align: "right" });
}

// Helper: table row with left label and right amount
function tableRow(doc, y, rowH, label, amount, opts = {}) {
  const {
    bg        = null,
    labelFont = "Helvetica",
    amtFont   = "Helvetica",
    size      = 10,
    labelColor = TEXT_PRIMARY,
    amtColor   = TEXT_PRIMARY,
    separator  = true,
  } = opts;

  if (bg) {
    doc.rect(MARGIN, y, CONTENT_W, rowH).fill(bg);
  }
  doc
    .font(labelFont).fontSize(size).fillColor(labelColor)
    .text(label, MARGIN + 16, y + (rowH - size) / 2 + 1, { width: CONTENT_W * 0.6 });
  doc
    .font(amtFont).fontSize(size).fillColor(amtColor)
    .text(amount, MARGIN, y + (rowH - size) / 2 + 1, { width: CONTENT_W - 16, align: "right" });
  if (separator) hRule(doc, y + rowH, BORDER, 0.5);
}

// ========================== TEACHER SPOTLIGHT INVOICES (new) ==========================

// Ensure teacher_invoices table exists (idempotent)
const createTeacherInvoicesTable = async () => {
  try {
    await client.execute(`
      CREATE TABLE IF NOT EXISTS teacher_invoices (
        invoice_id UUID PRIMARY KEY,
        teacher_email TEXT,
        plan_title TEXT,
        subtotal DECIMAL,
        platform_fee DECIMAL,
        gst DECIMAL,
        total_amount DECIMAL,
        currency TEXT,
        status TEXT,
        date DATE,
        due_date DATE,
        description TEXT,
        razorpay_payment_id TEXT,
        created_at TIMESTAMP,
        location_state TEXT,
        location_city TEXT,
        duration_days INT
      )
    `);
    await client.execute(`CREATE INDEX IF NOT EXISTS ON teacher_invoices(teacher_email)`);
    console.log("✅ teacher_invoices table ready");
  } catch (error) {
    console.error("❌ Error creating teacher_invoices table:", error.message);
  }
};
setTimeout(() => createTeacherInvoicesTable().catch(console.error), 4000);

// GET teacher invoices
router.get("/teacher-invoices", verifyToken, async (req, res) => {
  try {
    const teacher_email = req.user.email;
    const query = `SELECT * FROM teacher_invoices WHERE teacher_email = ?`;
    const result = await client.execute(query, [teacher_email], { prepare: true });

    const sortedRows = result.rows.sort((a, b) => new Date(b.date) - new Date(a.date));
    const invoices = sortedRows.map((row) => ({
      id: row.invoice_id,
      name: row.plan_title,
      description: row.description || `${row.plan_title} Subscription`,
      amount: `₹${parseFloat(row.total_amount).toFixed(2)}`,
      date: row.date,
      status: row.status,
      dueDate: row.due_date,
      subtotal: row.subtotal ? `₹${parseFloat(row.subtotal).toFixed(2)}` : null,
      platformFee: row.platform_fee ? `₹${parseFloat(row.platform_fee).toFixed(2)}` : null,
      gst: row.gst ? `₹${parseFloat(row.gst).toFixed(2)}` : null,
    }));

    const totalPaid = invoices.reduce(
      (sum, inv) => sum + (inv.status === "paid" ? parseFloat(inv.amount.replace("₹", "")) : 0),
      0
    );

    res.json({
      success: true,
      invoices,
      stats: {
        totalPaid: totalPaid.toFixed(2),
        nextPaymentDate: "",   // one-time spotlight has no recurring
        nextPaymentAmount: "",
      },
    });
  } catch (error) {
    console.error("Error fetching teacher invoices:", error);
    res.status(500).json({ success: false, message: "Failed to fetch teacher invoices" });
  }
});

// DOWNLOAD teacher invoice PDF (uses same professional layout)
router.get("/download-teacher-invoice/:invoiceId", verifyToken, async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const teacher_email = req.user.email;

    const query = `SELECT * FROM teacher_invoices WHERE invoice_id = ? AND teacher_email = ?`;
    const result = await client.execute(query, [invoiceId, teacher_email], { prepare: true });
    if (result.rowLength === 0) {
      return res.status(404).json({ success: false, message: "Invoice not found" });
    }
    const inv = result.rows[0];

    // ── Derived values ──
    const subtotal    = parseFloat(inv.subtotal    || 0);
    const platformFee = parseFloat(inv.platform_fee || 0);
    const gst         = parseFloat(inv.gst          || 0);
    const total       = parseFloat(inv.total_amount || 0);
    const INR         = (n) => `INR ${n.toFixed(2)}`;
    const fmt         = (d) =>
      new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
    const isPaid      = (inv.status || "").toLowerCase() === "paid";

    // ── Init PDF ──
    const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: `Teacher Invoice ${inv.invoice_id}`, Author: "GrowSmart" } });
    const filename = `GrowSmart_Teacher_Invoice_${inv.invoice_id}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    doc.pipe(res);

    // Header (identical to student invoice but with "GrowSmart Teacher")
    doc.rect(0, 0, PAGE_W, 120).fill(BRAND_DARK);
    doc.rect(0, 0, 5, 120).fill(BRAND_ACCENT);
    doc.font("Helvetica-Bold").fontSize(22).fillColor("#FFFFFF").text("GrowSmart", MARGIN, 30, { characterSpacing: 0.5 });
    doc.font("Helvetica").fontSize(8.5).fillColor("#94A3B8").text("Powered by Crowdteach Private Limited", MARGIN, 55, { characterSpacing: 0.2 });
    roundRect(doc, PAGE_W - MARGIN - 110, 28, 110, 30, 4, BRAND_ACCENT, null);
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#FFFFFF").text("TAX INVOICE", PAGE_W - MARGIN - 110, 38, { width: 110, align: "center", characterSpacing: 1.5 });
    doc.font("Helvetica").fontSize(7.5).fillColor("#64748B").text("CIN: U85500WB2025PTC277625", PAGE_W - MARGIN - 170, 68, { width: 170, align: "right" });

    // Meta block
    let y = 140;
    roundRect(doc, MARGIN, y, CONTENT_W, 78, 6, BRAND_LIGHT, null);
    doc.font("Helvetica-Bold").fontSize(12).fillColor(BRAND_ACCENT).text(`Invoice #${inv.invoice_id}`, MARGIN + 16, y + 14);
    doc.font("Helvetica").fontSize(9).fillColor(TEXT_MUTED).text(inv.plan_title || "Spotlight Subscription", MARGIN + 16, y + 32);
    const pillBg = isPaid ? SUCCESS_BG : PENDING_BG;
    const pillFg = isPaid ? SUCCESS_FG : PENDING_FG;
    const pillTx = isPaid ? "PAID" : (inv.status || "PENDING").toUpperCase();
    const pillW  = 62;
    roundRect(doc, PAGE_W - MARGIN - pillW - 14, y + 14, pillW, 22, 11, pillBg, null);
    doc.font("Helvetica-Bold").fontSize(8).fillColor(pillFg).text(pillTx, PAGE_W - MARGIN - pillW - 14, y + 20, { width: pillW, align: "center", characterSpacing: 1 });
    doc.font("Helvetica").fontSize(8.5).fillColor(TEXT_MUTED).text(`Issue Date:  ${fmt(inv.date)}`, MARGIN + 16, y + 52);
    doc.fillColor(TEXT_MUTED).text(`Due Date:  ${fmt(inv.due_date)}`, PAGE_W - MARGIN - 160, y + 52, { width: 160, align: "right" });

    y += 78 + 24;

    // Billed to (teacher email)
    const colW = (CONTENT_W - 16) / 2;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(TEXT_MUTED).text("BILLED TO", MARGIN, y, { characterSpacing: 1 });
    doc.font("Helvetica-Bold").fontSize(8).fillColor(TEXT_MUTED).text("PAYMENT DETAILS", MARGIN + colW + 16, y, { characterSpacing: 1 });
    y += 14;
    doc.font("Helvetica").fontSize(9.5).fillColor(TEXT_PRIMARY).text(teacher_email, MARGIN, y, { width: colW });
    doc.font("Helvetica").fontSize(9.5).fillColor(TEXT_PRIMARY).text(`Payment ID:`, MARGIN + colW + 16, y);
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(TEXT_PRIMARY).text(inv.razorpay_payment_id || "N/A", MARGIN + colW + 16, y + 13, { width: colW });
    y += 44;
    hRule(doc, y, BORDER, 0.75);
    y += 20;

    // Cost breakdown table
    doc.rect(MARGIN, y, CONTENT_W, 28).fill(BRAND_DARK);
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#FFFFFF").text("DESCRIPTION", MARGIN + 16, y + 10, { width: CONTENT_W * 0.6, characterSpacing: 0.8 });
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#FFFFFF").text("AMOUNT", MARGIN, y + 10, { width: CONTENT_W - 16, align: "right", characterSpacing: 0.8 });
    y += 28;

    const ROW_H = 36;
    tableRow(doc, y, ROW_H, `${inv.plan_title || "Spotlight"} — Base Price`, INR(subtotal), { bg: "#FFFFFF", size: 9.5 });
    y += ROW_H;
    tableRow(doc, y, ROW_H, "Platform Fee", INR(platformFee), { bg: "#F8FAFC", size: 9.5 });
    y += ROW_H;
    tableRow(doc, y, ROW_H, "GST @ 18%  (CGST 9% + SGST 9%)", INR(gst), { bg: "#FFFFFF", size: 9.5 });
    y += ROW_H;

    const TOTAL_H = 44;
    doc.rect(MARGIN, y, CONTENT_W, TOTAL_H).fill(BRAND_DARK);
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#FFFFFF").text("AMOUNT PAID", MARGIN + 16, y + (TOTAL_H - 11) / 2 + 1, { width: CONTENT_W * 0.6 });
    doc.font("Helvetica-Bold").fontSize(14).fillColor("#FFFFFF").text(INR(total), MARGIN, y + (TOTAL_H - 14) / 2 + 1, { width: CONTENT_W - 16, align: "right" });
    y += TOTAL_H + 28;

    // Footer note
    roundRect(doc, MARGIN, y, CONTENT_W, 28, 4, "#F1F5F9", null);
    doc.font("Helvetica").fontSize(8).fillColor(TEXT_MUTED).text(
      "All amounts are in Indian Rupees (INR). This is a computer-generated invoice and does not require a signature.",
      MARGIN + 12, y + 10, { width: CONTENT_W - 24 }
    );
    y += 28 + 24;

    hRule(doc, y, BORDER, 0.75);
    y += 16;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(TEXT_MUTED).text("TERMS & CONDITIONS", MARGIN, y, { characterSpacing: 0.8 });
    y += 14;
    doc.font("Helvetica").fontSize(8).fillColor(TEXT_MUTED).text(
      "1. For billing support, write to contact@gogrowsmart.com.",
      MARGIN, y, { width: CONTENT_W, lineGap: 3 }
    );

    // Footer band
    const footerY = PAGE_H - 52;
    doc.rect(0, footerY, PAGE_W, 52).fill(BRAND_DARK);
    doc.rect(0, footerY, PAGE_W, 3).fill(BRAND_ACCENT);
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#FFFFFF").text("GrowSmart", MARGIN, footerY + 14);
    doc.font("Helvetica").fontSize(7.5).fillColor("#94A3B8").text("Crowdteach Private Limited", MARGIN, footerY + 28);
    doc.font("Helvetica").fontSize(7.5).fillColor("#64748B").text(`Invoice ${inv.invoice_id}  ·  Generated ${new Date().toLocaleDateString("en-IN")}`, 0, footerY + 28, {
      width: PAGE_W - MARGIN, align: "right",
    });

    doc.end();
  } catch (error) {
    console.error("Error generating teacher invoice PDF:", error);
    res.status(500).json({ success: false, message: "Failed to generate invoice" });
  }
});

// ========================== ADMIN: SPOTLIGHT PURCHASES ==========================

// GET /api/billing/spotlight-purchases - Admin endpoint to get all spotlight purchase data
router.get("/spotlight-purchases", verifyToken, checkAdminRole, async (req, res) => {
  try {
    const invoicesQuery = `SELECT * FROM teacher_invoices`;
    const invoicesResult = await client.execute(invoicesQuery, [], { prepare: true });

    const purchases = [];
    for (const row of invoicesResult.rows) {
      const planTitle = row.plan_title || "";
      if (!planTitle.toLowerCase().includes("spotlight")) continue;

      // Get spotlight states for this invoice
      let purchasedStates = [];
      try {
        const statesQuery = `SELECT state, spotlight_type FROM spotlight_states WHERE invoice_id = ?`;
        const statesResult = await client.execute(statesQuery, [row.invoice_id], { prepare: true });
        purchasedStates = statesResult.rows.map((r) => ({
          state: r.state || "N/A",
          spotlightType: r.spotlight_type || "N/A",
        }));
      } catch (stateErr) {
        console.warn("⚠️ spotlight_states query skipped:", stateErr.message);
      }

      // Extract spotlight type from description if no states found
      let spotlightType = "N/A";
      if (purchasedStates.length === 0 && row.description) {
        const match = row.description.match(/\(([^)]+)\)$/);
        if (match) spotlightType = match[1];
      }

      // Get teacher name from teachers1
      let teacherName = row.teacher_email?.split("@")[0] || "Unknown";
      try {
        const teacherQuery = `SELECT name FROM teachers1 WHERE email = ? ALLOW FILTERING`;
        const teacherResult = await client.execute(teacherQuery, [row.teacher_email], { prepare: true });
        if (teacherResult.rowLength > 0) {
          teacherName = teacherResult.rows[0].name;
        }
      } catch (e) {
        // keep fallback name
      }

      // Use spotlight_states if available, otherwise fall back to invoice location
      const statesToShow = purchasedStates.length > 0 ? purchasedStates : [
        { state: row.location_state || "N/A", spotlightType }
      ];

      for (const st of statesToShow) {
        purchases.push({
          teacherName,
          teacherEmail: row.teacher_email || "",
          homeState: row.location_state || "N/A",
          homeCity: row.location_city || "N/A",
          purchaseState: st.state,
          spotlightType: st.spotlightType,
          amount: parseFloat(row.total_amount || 0),
          currency: row.currency || "INR",
          status: (row.status || "N/A").charAt(0).toUpperCase() + (row.status || "N/A").slice(1),
          date: row.date ? new Date(row.date).toISOString().split("T")[0] : "N/A",
          planTitle,
          invoiceId: row.invoice_id?.toString() || "",
        });
      }
    }

    res.json({ success: true, purchases });
  } catch (error) {
    console.error("Error fetching spotlight purchases:", error);
    res.status(500).json({ success: false, message: "Failed to fetch spotlight purchases" });
  }
});

module.exports = router;