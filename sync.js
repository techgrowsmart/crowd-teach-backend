require('dotenv').config();
const client = require('./config/db');

async function syncTuitionsToTeacherInfo() {
    try {
        console.log('🔄 Starting sync of tuitions from teachers1 to teacher_info...');
        
        // Wait for Cassandra connection to be established
        console.log('⏳ Waiting for Cassandra connection...');
        await client.connect();
        console.log('✅ Connected to Cassandra');
        
        // Fetch all teachers from teachers1 table including profilepic and introduction
        const teachers1Query = `SELECT email, name, tuitions, profilepic, introduction FROM teachers1`;
        const teachers1Result = await client.execute(teachers1Query, [], { prepare: true });
        
        console.log(`📊 Found ${teachers1Result.rows.length} teachers in teachers1 table`);
        
        let syncCount = 0;
        let skipCount = 0;
        let errorCount = 0;
        
        for (const teacher of teachers1Result.rows) {
            try {
                // Check if row exists in teacher_info for this email
                const checkQuery = `SELECT id FROM teacher_info WHERE email = ? LIMIT 1`;
                const checkResult = await client.execute(checkQuery, [teacher.email], { prepare: true });
                
                if (checkResult.rows.length > 0) {
                    // Update existing rows in teacher_info for this email
                    for (const row of checkResult.rows) {
                        const teacherId = row.id;

                        const updateQuery = `UPDATE teacher_info SET tutions = ?, profilepic = ?, introduction = ? WHERE id = ? AND email = ?`;
                        const params = [teacher.tuitions, teacher.profilepic || '', teacher.introduction || '', teacherId, teacher.email];

                        await client.execute(updateQuery, params, { prepare: true });
                        syncCount++;
                        console.log(`✅ Updated: email=${teacher.email}, id=${teacherId}`);
                    }
                } else {
                    // Insert new row into teacher_info since it doesn't exist
                    // Generate a simple ID based on email
                    const teacherId = teacher.email.split('@')[0];
                    
                    const insertQuery = `INSERT INTO teacher_info (id, email, name, introduction, profilepic, tutions) VALUES (?, ?, ?, ?, ?, ?)`;
                    const params = [
                        teacherId,
                        teacher.email,
                        teacher.name,
                        teacher.introduction || '',
                        teacher.profilepic || '',
                        teacher.tuitions
                    ];
                    
                    await client.execute(insertQuery, params, { prepare: true });
                    syncCount++;
                    console.log(`✅ Inserted: email=${teacher.email}, id=${teacherId}`);
                }
            } catch (err) {
                errorCount++;
                console.error(`❌ Error syncing email=${teacher.email}:`, err.message);
            }
        }
        
        console.log('\n📊 Sync Summary:');
        console.log(`✅ Successfully synced: ${syncCount}`);
        console.log(`⚠️ Skipped (no teacher_info record): ${skipCount}`);
        console.log(`❌ Errors: ${errorCount}`);
        console.log(`📋 Total processed: ${teachers1Result.rows.length}`);
        
        process.exit(0);
    } catch (error) {
        console.error('❌ Fatal error during sync:', error);
        process.exit(1);
    }
}

syncTuitionsToTeacherInfo();