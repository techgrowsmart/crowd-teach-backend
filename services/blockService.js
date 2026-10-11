/**
 * Block Service - one-way chat blocks between two users
 *
 * A row (blocker_email, blocked_email) means "blocker has blocked blocked".
 * Each direction is its own row owned by the blocker, so only the user who
 * created a block can remove it. If both users block each other there are two
 * rows and each user can only lift their own.
 */

const client = require('../config/db');

let tableReady = null;

function ensureTable() {
  if (!tableReady) {
    tableReady = client.execute(`
      CREATE TABLE IF NOT EXISTS user_blocks (
        blocker_email TEXT,
        blocked_email TEXT,
        created_at TIMESTAMP,
        PRIMARY KEY (blocker_email, blocked_email)
      )
    `).catch((error) => {
      // Let the next call retry instead of caching the failure
      tableReady = null;
      throw error;
    });
  }
  return tableReady;
}

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

async function hasBlocked(blockerEmail, blockedEmail) {
  const result = await client.execute(
    'SELECT blocker_email FROM user_blocks WHERE blocker_email = ? AND blocked_email = ?',
    [normalizeEmail(blockerEmail), normalizeEmail(blockedEmail)],
    { prepare: true }
  );
  return !!(result.rows && result.rows.length > 0);
}

/**
 * Block state of a conversation from `userEmail`'s point of view
 * @returns {Promise<{ blockedByMe: boolean, blockedMe: boolean }>}
 */
async function getBlockState(userEmail, contactEmail) {
  await ensureTable();
  const [blockedByMe, blockedMe] = await Promise.all([
    hasBlocked(userEmail, contactEmail),
    hasBlocked(contactEmail, userEmail)
  ]);
  return { blockedByMe, blockedMe };
}

// Emails (lowercased) of everyone `userEmail` has blocked
async function getBlockedEmails(userEmail) {
  await ensureTable();
  const result = await client.execute(
    'SELECT blocked_email FROM user_blocks WHERE blocker_email = ?',
    [normalizeEmail(userEmail)],
    { prepare: true }
  );
  return (result.rows || []).map(row => row.blocked_email);
}

async function blockUser(blockerEmail, blockedEmail) {
  await ensureTable();
  await client.execute(
    'INSERT INTO user_blocks (blocker_email, blocked_email, created_at) VALUES (?, ?, ?)',
    [normalizeEmail(blockerEmail), normalizeEmail(blockedEmail), new Date()],
    { prepare: true }
  );
}

// Only ever deletes the caller's own row, so a user can never lift a block placed on them
async function unblockUser(blockerEmail, blockedEmail) {
  await ensureTable();
  await client.execute(
    'DELETE FROM user_blocks WHERE blocker_email = ? AND blocked_email = ?',
    [normalizeEmail(blockerEmail), normalizeEmail(blockedEmail)],
    { prepare: true }
  );
}

module.exports = {
  ensureTable,
  normalizeEmail,
  getBlockState,
  getBlockedEmails,
  blockUser,
  unblockUser
};
