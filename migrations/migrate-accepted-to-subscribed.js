require('dotenv').config();
const cassandra = require('cassandra-driver');

const cloud = { secureConnectBundle: "./secure-connect-gogrowsmart.zip" };
const authProvider = new cassandra.auth.PlainTextAuthProvider(process.env.ASTRA_DB_USERNAME, process.env.ASTRA_DB_PASSWORD);
const client = new cassandra.Client({
    keyspace: process.env.ASTRA_DB_KEYSPACE,
    cloud,
    authProvider
});

/**
 * Migration: accepting a booking now subscribes the student directly.
 * Bookings left in the old intermediate 'accepted' status are moved to 'subscribed'
 * so those students show as Subscribed and are included in broadcast groups.
 *
 * Run from crowd-teach-backend/: node migrations/migrate-accepted-to-subscribed.js
 */
async function migrateAcceptedToSubscribed() {
  try {
    console.log('🔄 Connecting to Cassandra...');
    await client.connect();
    console.log('✅ Connected to Cassandra');

    const result = await client.execute(
      `SELECT id, student_email, teacher_email, subject FROM booking_requests WHERE status = ? ALLOW FILTERING`,
      ['accepted'],
      { prepare: true }
    );

    console.log(`📋 Found ${result.rows.length} accepted bookings`);

    for (const row of result.rows) {
      await client.execute(
        `UPDATE booking_requests SET status = ?, updated_at = ? WHERE id = ?`,
        ['subscribed', new Date(), row.id],
        { prepare: true }
      );
      console.log(`✅ ${row.id}: ${row.student_email} -> ${row.teacher_email} (${row.subject}) now subscribed`);
    }

    console.log('🎉 Migration complete');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exitCode = 1;
  } finally {
    await client.shutdown();
  }
}

migrateAcceptedToSubscribed();
