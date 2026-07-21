const express = require('express');
const router = express.Router();
const { createOrder, verifyPayment } = require('../../services/razorpayService');
const client = require('../../config/db');
const axios = require('axios')
const cassandra= require('cassandra-driver')
const verifyToken = require('../../utils/verifyToken');
const { v4: uuidv4 } = require('uuid');

// Helper to create class invoice after successful payment
// Create Razorpay order
router.post('/create-order', async (req, res) => {
    try {
        const { amount } = req.body;

        if (!amount || isNaN(amount) || amount < 1) {
            return res.status(400).json({ error: 'Invalid amount' });
        }

        const order = await createOrder(amount);
        console.log("ORDER",order)
        res.json(order);
    } catch (error) {
        console.error('Error creating order:', error);
        res.status(500).json({ error: 'Failed to create payment order' });
    }
});

router.post('/verify-payment-spotlight', verifyToken, async (req, res) => {
  try {
    const {
      orderId, paymentId, signature, email, name, amount,
      planLabel, planType, state, city,
      baseAmount, platformFee, gst, totalAmount,
      spotlightType
    } = req.body;

    if (!orderId || !paymentId || !signature || !email || !amount || !name) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Verify Razorpay signature
    const isValid = verifyPayment(orderId, paymentId, signature);
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }

    // --- Step 1: Fetch the teacher's name from teachers1 table using email
    // Since teachers1 has primary key (email, name), we need name for update.
    const getNameQuery = `SELECT name FROM teachers1 WHERE email = ? ALLOW FILTERING`;
    const nameResult = await client.execute(getNameQuery, [email], { prepare: true });
    let teacherName = name;
    if (nameResult.rowLength === 0) {
      // Fallback: use the name from request body (passed from frontend)
      console.log(`⚠️ Teacher not found in teachers1, using request name: ${name}`);
    } else {
      teacherName = nameResult.rows[0].name;
    }

    // Normalize the purchased spotlight type: skill, subject, or both
    const rawSpotlightType = spotlightType ? String(spotlightType).toLowerCase() : '';
    const normalizedSpotlightType =
      rawSpotlightType.includes('skill') ? 'skill' :
      rawSpotlightType.includes('subject') ? 'subject' : 'both';

    // Check if teacher already has the other spotlight type purchased
    const existingInvoicesQuery = `SELECT description FROM teacher_invoices WHERE teacher_email = ? AND status = 'paid' ALLOW FILTERING`;
    const existingInvoicesResult = await client.execute(existingInvoicesQuery, [email], { prepare: true });
    
    let finalSpotlightType = normalizedSpotlightType;
    if (existingInvoicesResult.rowLength > 0) {
        const descriptions = existingInvoicesResult.rows.map(row => row.description || '').join(' ').toLowerCase();
        const hasSkill = descriptions.includes('skill');
        const hasSubject = descriptions.includes('subject');
        
        // If purchasing skill and already has subject, or vice versa, set to Both
        if (normalizedSpotlightType === 'skill' && hasSubject) {
            finalSpotlightType = 'both';
        } else if (normalizedSpotlightType === 'subject' && hasSkill) {
            finalSpotlightType = 'both';
        }
    }

    // Update teacher spotlight status (3 months expiry)
    const expiry = new Date();
    expiry.setMonth(expiry.getMonth() + 3);
    const updateQuery = `
      UPDATE teachers1
      SET isspotlight = true, spotlight_type = ?, subscription_expiry = ?
      WHERE email = ? AND name = ?
    `;
    await client.execute(updateQuery, [finalSpotlightType, expiry, email, teacherName], { prepare: true });

    // --- Create teacher invoice record (no change here) ---
    const invoiceId = require('uuid').v4();
    const currentDate = new Date();
    const dueDate = new Date(currentDate);
    dueDate.setDate(dueDate.getDate() + 30);

    const finalBase = parseFloat(baseAmount) || parseFloat(amount) || 0;
    const finalPlatform = parseFloat(platformFee) || 4;
    const finalGst = parseFloat(gst) || ((finalBase + finalPlatform) * 0.18);
    const finalTotal = parseFloat(totalAmount) || (finalBase + finalPlatform + finalGst);

    const invoiceQuery = `
      INSERT INTO teacher_invoices (
        invoice_id, teacher_email, plan_title,
        subtotal, platform_fee, gst, total_amount, currency,
        status, date, due_date, description, razorpay_payment_id,
        created_at, location_state, location_city, duration_days
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await client.execute(invoiceQuery, [
      invoiceId,
      email,
      planLabel || 'Spotlight Subscription - 3 Months',
      finalBase,
      finalPlatform,
      finalGst,
      finalTotal,
      'INR',
      'paid',
      currentDate.toISOString().split('T')[0],
      dueDate.toISOString().split('T')[0],
      `Spotlight promotion in ${city}, ${state} – 3 months (${normalizedSpotlightType})`,
      paymentId,
      currentDate,
      state || null,
      city || null,
      90
    ], { prepare: true });

    console.log(`✅ Spotlight invoice ${invoiceId} created for teacher ${email}`);

    // ── Write per-state spotlight row (supports multi-state purchases) ──
    // Each purchased state gets its own row; type can be 'skill', 'subject', or 'both'.
    if (state) {
      const statesToInsert = Array.isArray(state) ? state : [state];
      const spotlightStateQuery = `
        INSERT INTO spotlight_states (teacher_email, state, spotlight_type, expiry, invoice_id)
        VALUES (?, ?, ?, ?, ?)
      `;
      for (const s of statesToInsert) {
        await client.execute(spotlightStateQuery, [email, s, finalSpotlightType, expiry, invoiceId], { prepare: true });
      }
      console.log(`✅ spotlight_states rows written for teacher ${email} → states: ${statesToInsert.join(', ')}`);
    }

    res.json({ success: true, message: "Spotlight activated successfully.", invoiceId });
  } catch (err) {
    console.error('Error verifying payment:', err);
    res.status(500).json({ error: 'Failed to verify payment' });
  }
});

// GET /api/payments/spotlight-my-states  – returns all active spotlight purchases for the logged-in teacher
router.get('/spotlight-my-states', verifyToken, async (req, res) => {
  try {
    const email = req.user?.email;
    if (!email) return res.status(401).json({ error: 'Unauthorized' });

    const now = new Date();
    const result = await client.execute(
      `SELECT state, spotlight_type, expiry, invoice_id FROM spotlight_states WHERE teacher_email = ?`,
      [email], { prepare: true }
    );

    const states = [];
    for (const row of result.rows) {
      if (row.expiry && new Date(row.expiry) > now) {
        states.push({
          state: row.state,
          spotlight_type: row.spotlight_type,
          expiry: row.expiry,
          invoice_id: row.invoice_id,
        });
      }
    }

    res.json({ success: true, states });
  } catch (err) {
    console.error('Error fetching spotlight states:', err);
    res.status(500).json({ error: 'Failed to fetch spotlight states' });
  }
});

module.exports = router;
