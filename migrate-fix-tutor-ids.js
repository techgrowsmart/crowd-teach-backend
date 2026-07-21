// migrate-fix-tutor-ids.js
const client = require('./config/db');

async function fixTutorIds() {
    // Get all teacher users
    const usersQuery = "SELECT id, email FROM users WHERE role = 'teacher' ALLOW FILTERING";
    const users = await client.execute(usersQuery, [], { prepare: true });
    console.log(`Found ${users.rowLength} teacher users`);

    let deleted = 0;
    for (const user of users.rows) {
        const correctId = user.id;
        const email = user.email;
        // Find tutors with this email but wrong ID
        const tutorsQuery = "SELECT id FROM tutors WHERE email = ? ALLOW FILTERING";
        const tutors = await client.execute(tutorsQuery, [email], { prepare: true });
        for (const tutor of tutors.rows) {
            if (tutor.id.toString() !== correctId.toString()) {
                // Delete the wrong tutor record
                await client.execute(
                    "DELETE FROM tutors WHERE id = ? AND email = ?",
                    [tutor.id, email],
                    { prepare: true }
                );
                console.log(`🗑️ Deleted wrong tutor record for ${email} (old ID: ${tutor.id})`);
                deleted++;
            }
        }
    }
    console.log(`✅ Migration complete. Deleted ${deleted} incorrect tutor records.`);
    process.exit(0);
}

fixTutorIds().catch(err => {
    console.error("Migration failed:", err);
    process.exit(1);
});