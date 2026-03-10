require("dotenv").config();
const cassandra = require("cassandra-driver");

// Database connection
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

async function fixTestUsers() {
  try {
    console.log("🔗 Connecting to database...");
    await client.connect();
    console.log("✅ Connected to database");

    const testUsers = [
      { email: "student1@example.com", name: "Test Student", role: "student" },
      { email: "teacher56@example.com", name: "Teacher Five", role: "teacher" }
    ];

    for (const user of testUsers) {
      console.log(`\n🔄 Processing user: ${user.email}`);
      
      // Check current user data
      const checkQuery = "SELECT * FROM users WHERE email = ?";
      const result = await client.execute(checkQuery, [user.email], { prepare: true });
      
      if (result.rowLength === 0) {
        console.log(`❌ User ${user.email} not found`);
        continue;
      }
      
      const currentUser = result.rows[0];
      console.log(`📋 Current role: ${currentUser.role || 'NULL'}`);
      console.log(`📋 Current name: ${currentUser.name || 'NULL'}`);
      
      // Update user role and name
      const updateQuery = "UPDATE users SET role = ?, name = ? WHERE id = ?";
      await client.execute(updateQuery, [user.role, user.name, currentUser.id], { prepare: true });
      
      console.log(`✅ Updated ${user.email}:`);
      console.log(`   - Role: ${user.role}`);
      console.log(`   - Name: ${user.name}`);
      
      // Verify the update
      const verifyQuery = "SELECT * FROM users WHERE email = ?";
      const verifyResult = await client.execute(verifyQuery, [user.email], { prepare: true });
      
      if (verifyResult.rowLength > 0) {
        const updatedUser = verifyResult.rows[0];
        console.log(`🔍 Verification - Role: ${updatedUser.role}`);
        console.log(`🔍 Verification - Name: ${updatedUser.name}`);
        console.log(`🔍 Verification - Status: ${updatedUser.status}`);
      }
    }

  } catch (error) {
    console.error("❌ Error fixing test users:", error);
  } finally {
    await client.shutdown();
    console.log("\n🔌 Database connection closed");
    console.log("🎉 Test user fixes completed!");
  }
}

fixTestUsers();
