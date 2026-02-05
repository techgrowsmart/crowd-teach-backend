require("dotenv").config();
const cassandra = require("cassandra-driver");
const { v4: uuidv4 } = require("uuid");

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

async function createTestStudent() {
  try {
    console.log("🔗 Connecting to database...");
    await client.connect();
    console.log("✅ Connected to database");

    const studentId = uuidv4();
    const email = "student1@example.com";
    const fullName = "Test Student";
    const phoneNumber = "+1234567890";
    const role = "student";
    const status = "active";
    const createdAt = new Date();

    // Insert the test student
    const insertUserQuery = `
      INSERT INTO users (
        id, 
        email, 
        name, 
        phonenumber, 
        created_at
      ) VALUES (?, ?, ?, ?, ?)
    `;

    const params = [
      studentId,
      email,
      fullName,
      phoneNumber,
      createdAt
    ];

    console.log("👤 Creating test student:", { email, fullName, role });
    await client.execute(insertUserQuery, params, { prepare: true });
    console.log("✅ Test student created successfully!");

    // Verify the user was created
    const verifyQuery = "SELECT * FROM users WHERE email = ?";
    const result = await client.execute(verifyQuery, [email], { prepare: true });
    
    if (result.rowLength > 0) {
      const user = result.rows[0];
      console.log("✅ User verification successful:");
      console.log("   - Email:", user.email);
      console.log("   - Name:", user.full_name);
      console.log("   - Role:", user.role);
      console.log("   - Status:", user.status);
      console.log("   - ID:", user.id);
    } else {
      console.log("❌ User verification failed - user not found");
    }

  } catch (error) {
    console.error("❌ Error creating test student:", error);
  } finally {
    await client.shutdown();
    console.log("🔌 Database connection closed");
  }
}

createTestStudent();
