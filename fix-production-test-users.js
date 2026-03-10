require("dotenv").config();
const cassandra = require("cassandra-driver");

// Database connection - using same config as db.js
const cloud = { secureConnectBundle: "./secure-connect-gogrowsmart.zip" };
const authProvider = new cassandra.auth.PlainTextAuthProvider('token', process.env['ASTRA_TOKEN']);
const credentials = {
    username: process.env.ASTRA_DB_USERNAME,
    password: process.env.ASTRA_DB_PASSWORD
};
const client = new cassandra.Client({ 
    keyspace: process.env.ASTRA_DB_KEYSPACE, 
    cloud, 
    authProvider,  
    credentials
});

async function fixProductionTestUsers() {
  try {
    console.log("🔗 Connecting to production database...");
    await client.connect();
    console.log("✅ Connected to production database");

    const testUsers = [
      { email: "student1@example.com", name: "Test Student", role: "student" },
      { email: "teacher56@example.com", name: "Test Teacher", role: "teacher" }
    ];

    for (const user of testUsers) {
      console.log(`\n🔄 Processing user: ${user.email}`);
      
      // Check if user exists
      const checkQuery = "SELECT * FROM users WHERE email = ?";
      const result = await client.execute(checkQuery, [user.email], { prepare: true });
      
      if (result.rowLength === 0) {
        console.log(`❌ User ${user.email} not found in database - CREATING...`);
        
        // Create the user if it doesn't exist
        const userId = cassandra.types.Uuid.random();
        const insertQuery = `
          INSERT INTO users (id, email, name, role, status, created_at) 
          VALUES (?, ?, ?, ?, ?, toTimestamp(now()))
        `;
        await client.execute(insertQuery, [
          userId, 
          user.email, 
          user.name, 
          user.role, 
          "active"
        ], { prepare: true });
        
        console.log(`✅ Created ${user.email} with status: active`);
      } else {
        const currentUser = result.rows[0];
        console.log(`📋 Current status: ${currentUser.status || 'NULL'}`);
        console.log(`📋 Current role: ${currentUser.role || 'NULL'}`);
        console.log(`📋 Current name: ${currentUser.name || 'NULL'}`);
        
        // Update user status to active and ensure correct role/name
        const updateQuery = "UPDATE users SET status = ?, name = ?, role = ? WHERE id = ?";
        await client.execute(updateQuery, [
          "active", 
          user.name, 
          user.role, 
          currentUser.id
        ], { prepare: true });
        
        console.log(`✅ Updated ${user.email} status to: active`);
      }
      
      // Verify the final state
      const verifyQuery = "SELECT * FROM users WHERE email = ?";
      const verifyResult = await client.execute(verifyQuery, [user.email], { prepare: true });
      
      if (verifyResult.rowLength > 0) {
        const finalUser = verifyResult.rows[0];
        console.log(`🔍 Final Status: ${finalUser.status}`);
        console.log(`🔍 Final Name: ${finalUser.name}`);
        console.log(`🔍 Final Role: ${finalUser.role}`);
        console.log(`🔍 User ID: ${finalUser.id}`);
      }
    }

    console.log("\n🎯 Production test users setup completed!");
    console.log("📱 The following users should now work without OTP:");
    console.log("   • student1@example.com (student)");
    console.log("   • teacher56@example.com (teacher)");

  } catch (error) {
    console.error("❌ Error fixing production test users:", error);
  } finally {
    await client.shutdown();
    console.log("\n🔌 Database connection closed");
  }
}

// Also create a function to test the OTP bypass logic
async function testOTPBypass() {
  console.log("\n🧪 Testing OTP bypass logic...");
  
  const testUsers = ["student1@example.com", "teacher56@example.com"];
  
  testUsers.forEach(email => {
    console.log(`✅ ${email} should bypass OTP and login directly`);
  });
  
  console.log("📝 To test manually:");
  console.log("1. Use the mobile app with production server URL");
  console.log("2. Try login with student1@example.com");
  console.log("3. Try login with teacher56@example.com");
  console.log("4. Both should login without OTP requirement");
}

fixProductionTestUsers().then(() => {
  testOTPBypass();
}).catch(error => {
  console.error("❌ Script failed:", error);
});
