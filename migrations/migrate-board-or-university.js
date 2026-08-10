require('dotenv').config();
const cassandra = require('cassandra-driver');
const path = require('path');

// Load environment variables
const cloud = { secureConnectBundle: "./secure-connect-gogrowsmart.zip" };
const authProvider = new cassandra.auth.PlainTextAuthProvider(process.env.ASTRA_DB_USERNAME, process.env.ASTRA_DB_PASSWORD);
const client = new cassandra.Client({ 
    keyspace: process.env.ASTRA_DB_KEYSPACE, 
    cloud, 
    authProvider
});

/**
 * Migration script to update contacts table with board_or_university
 * This script reads contacts that have null board_or_university and
 * updates them from the corresponding booking_requests table
 */

async function migrateBoardOrUniversity() {
  try {
    console.log('🚀 Starting board_or_university migration...');
    
    // Connect to Cassandra
    console.log('🔄 Connecting to Cassandra...');
    await client.connect();
    console.log('✅ Connected to Cassandra');

    // First, add the board_or_university column to booking_requests if it doesn't exist
    console.log('🔧 Adding board_or_university column to booking_requests table...');
    try {
      await client.execute(`
        ALTER TABLE booking_requests ADD board_or_university TEXT
      `);
      console.log('✅ Added board_or_university column to booking_requests table');
    } catch (alterError) {
      if (alterError.message.includes('already exists')) {
        console.log('✅ board_or_university column already exists in booking_requests');
      } else {
        console.warn('⚠️ Could not add column to booking_requests (may already exist):', alterError.message);
      }
    }

    // Add the board_or_university column to contacts if it doesn't exist
    console.log('🔧 Adding board_or_university column to contacts table...');
    try {
      await client.execute(`
        ALTER TABLE contacts ADD board_or_university TEXT
      `);
      console.log('✅ Added board_or_university column to contacts table');
    } catch (alterError) {
      if (alterError.message.includes('already exists')) {
        console.log('✅ board_or_university column already exists in contacts');
      } else {
        console.warn('⚠️ Could not add column to contacts (may already exist):', alterError.message);
      }
    }

    // Fetch all contacts and filter for null/empty board_or_university in JavaScript
    const contactsQuery = `
      SELECT id, teacher_email, student_email, subject, class_name, board_or_university
      FROM contacts
      ALLOW FILTERING
    `;
    
    const contactsResult = await client.execute(contactsQuery, [], { prepare: true });
    
    // Filter contacts that need migration (null or empty board_or_university)
    const contactsNeedingMigration = contactsResult.rows.filter(row => 
      !row.board_or_university || row.board_or_university.trim() === ''
    );
    
    if (!contactsNeedingMigration || contactsNeedingMigration.length === 0) {
      console.log('✅ No contacts need migration. All contacts already have board_or_university.');
      await client.shutdown();
      return;
    }

    console.log(`📋 Found ${contactsNeedingMigration.length} contacts needing migration`);

    let updatedCount = 0;
    let skippedCount = 0;

    for (const contact of contactsNeedingMigration) {
      try {
        // Look for corresponding booking request
        const bookingQuery = `
          SELECT board_or_university
          FROM booking_requests
          WHERE teacher_email = ? 
            AND student_email = ? 
            AND subject = ? 
            AND class_name = ?
          LIMIT 1
          ALLOW FILTERING
        `;
        
        const bookingResult = await client.execute(bookingQuery, [
          contact.teacher_email,
          contact.student_email,
          contact.subject,
          contact.class_name
        ], { prepare: true });

        if (bookingResult.rows && bookingResult.rows.length > 0) {
          const boardOrUniversity = bookingResult.rows[0].board_or_university;
          
          if (boardOrUniversity && boardOrUniversity.trim() !== '') {
            // Update the contact with board_or_university
            const updateQuery = `
              UPDATE contacts
              SET board_or_university = ?, updated_at = ?
              WHERE id = ?
            `;
            
            await client.execute(updateQuery, [
              boardOrUniversity,
              new Date(),
              contact.id
            ], { prepare: true });
            
            console.log(`✅ Updated contact ${contact.id}: ${contact.teacher_email} <-> ${contact.student_email} (${contact.subject} - ${contact.class_name}) -> board: ${boardOrUniversity}`);
            updatedCount++;
          } else {
            console.log(`⏭️  Skipped contact ${contact.id}: No board_or_university in booking request`);
            skippedCount++;
          }
        } else {
          console.log(`⏭️  Skipped contact ${contact.id}: No matching booking request found`);
          skippedCount++;
        }
      } catch (error) {
        console.error(`❌ Error migrating contact ${contact.id}:`, error.message);
      }
    }

    console.log('\n📊 Migration Summary:');
    console.log(`   ✅ Updated: ${updatedCount} contacts`);
    console.log(`   ⏭️  Skipped: ${skippedCount} contacts`);
    console.log(`   📋 Total processed: ${contactsNeedingMigration.length} contacts`);
    console.log('\n🎉 Migration completed successfully!');
    
    // Disconnect from Cassandra
    await client.shutdown();
    console.log('✅ Disconnected from Cassandra');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    await client.shutdown();
    process.exit(1);
  }
}

// Run migration
migrateBoardOrUniversity()
  .then(() => {
    console.log('✅ Migration script finished');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Migration script error:', error);
    process.exit(1);
  });
