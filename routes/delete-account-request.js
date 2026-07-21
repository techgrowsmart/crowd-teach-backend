const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const client = require('../config/db');

const VALID_SOURCES = ['landing', 'mobile-app'];

// Ensure the account_deletion_requests table exists in AstraDB
(async function ensureAccountDeletionRequestsTable() {
  try {
    const query = `
      CREATE TABLE IF NOT EXISTS account_deletion_requests (
        id UUID PRIMARY KEY,
        email TEXT,
        user_type TEXT,
        issue TEXT,
        phone TEXT,
        details TEXT,
        source TEXT,
        status TEXT,
        created_at TIMESTAMP,
        updated_at TIMESTAMP
      )
    `;
    await client.execute(query);
    console.log('✅ account_deletion_requests table ensured');
  } catch (error) {
    console.error('❌ Error ensuring account_deletion_requests table:', error);
  }
})();

/**
 * POST /api/delete-account-request
 * Receives a voluntary account deletion request and stores it in AstraDB.
 * The support/admin team can later review and process these requests
 * through the admin dashboard.
 */
router.post('/delete-account-request', async (req, res) => {
  try {
    const { email, userType, issue, phone, details, source } = req.body;

    // Validation
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'A valid registered email address is required.'
      });
    }

    if (!userType || !['teacher', 'student'].includes(userType)) {
      return res.status(400).json({
        success: false,
        message: 'User type must be either teacher or student.'
      });
    }

    const requestId = uuidv4();
    const normalizedSource = VALID_SOURCES.includes(source) ? source : 'unknown';
    const now = new Date();

    const insertQuery = `
      INSERT INTO account_deletion_requests (
        id, email, user_type, issue, phone, details, source, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await client.execute(
      insertQuery,
      [
        requestId,
        email,
        userType,
        issue || null,
        phone || null,
        details || null,
        normalizedSource,
        'pending',
        now,
        now
      ],
      { prepare: true }
    );

    console.log(`✅ Delete-account request saved to AstraDB: ${requestId} for ${email}`);

    return res.status(200).json({
      success: true,
      message: 'Your account deletion request has been received. Our team will review and process it shortly.',
      requestId
    });
  } catch (error) {
    console.error('❌ Error saving delete-account request:', error);
    return res.status(500).json({
      success: false,
      message: 'We could not save your request. Please try again or contact contact@gogrowsmart.com.'
    });
  }
});

/**
 * GET /api/delete-account-request/status?email=user@example.com
 * Returns whether the user has a pending account deletion request.
 * This is checked on app login/Settings open so the "Delete Requested"
 * state persists across devices and logout/login cycles.
 */
router.get('/delete-account-request/status', async (req, res) => {
  try {
    const { email } = req.query;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'A valid email query parameter is required.'
      });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    const query = `
      SELECT id, status
      FROM account_deletion_requests
      WHERE email = ? AND status = 'pending'
      LIMIT 1
      ALLOW FILTERING
    `;

    const result = await client.execute(query, [normalizedEmail], { prepare: true });

    const hasPendingRequest = result.rowLength > 0;

    return res.status(200).json({
      success: true,
      requested: hasPendingRequest,
      requestId: hasPendingRequest ? result.rows[0].id : null,
      status: hasPendingRequest ? result.rows[0].status : null
    });
  } catch (error) {
    console.error('❌ Error checking delete-account request status:', error);
    return res.status(500).json({
      success: false,
      message: 'Could not check deletion request status.'
    });
  }
});

module.exports = router;
