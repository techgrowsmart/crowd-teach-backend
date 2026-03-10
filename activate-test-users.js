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

async function activateTestUsers() {
  try {
    console.log("🔗 Connecting to database...");
    await client.connect();
    console.log("✅ Connected to database");

    const testUsers = [
      { email: "student1@example.com", name: "Test Student", role: "student" },
      { email: "teacher56@example.com", name: "Test Teacher", role: "teacher" }
    ];

    for (const user of testUsers) {
      console.log(`\n🔄 Processing user: ${user.email}`);
      
      // Check current user status
      const checkQuery = "SELECT * FROM users WHERE email = ?";
      const result = await client.execute(checkQuery, [user.email], { prepare: true });
      
      if (result.rowLength === 0) {
        console.log(`❌ User ${user.email} not found in database`);
        continue;
      }
      
      const currentUser = result.rows[0];
      console.log(`📋 Current status: ${currentUser.status || 'NULL'}`);
      
      // Update user status to active
      const updateQuery = "UPDATE users SET status = ? WHERE id = ?";
      await client.execute(updateQuery, ["active", currentUser.id], { prepare: true });
      
      console.log(`✅ Updated ${user.email} status to: active`);
      
      // Verify the update
      const verifyQuery = "SELECT * FROM users WHERE email = ?";
      const verifyResult = await client.execute(verifyQuery, [user.email], { prepare: true });
      
      if (verifyResult.rowLength > 0) {
        const updatedUser = verifyResult.rows[0];
        console.log(`🔍 Verification - Status: ${updatedUser.status}`);
        console.log(`🔍 Verification - Name: ${updatedUser.name}`);
        console.log(`🔍 Verification - Role: ${updatedUser.role}`);
      }
    }

  } catch (error) {
    console.error("❌ Error activating test users:", error);
  } finally {
    await client.shutdown();
    console.log("\n🔌 Database connection closed");
    console.log("🎉 Test user activation completed!");
  }
}

activateTestUsers();
