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

async function fixStudentUser() {
  try {
    console.log("🔗 Connecting to database...");
    await client.connect();
    console.log("✅ Connected to database");

    const email = "student1@example.com";

    // First, get the user to get their ID
    const getUserQuery = "SELECT id FROM users WHERE email = ? ALLOW FILTERING";
    const userResult = await client.execute(getUserQuery, [email], { prepare: true });

    if (userResult.rowLength === 0) {
      console.log("❌ User not found");
      return;
    }

    const userId = userResult.rows[0].id;
    console.log("📝 Found user ID:", userId);

    // Update the user with role and status
    const updateQuery = "UPDATE users SET role = ?, status = ? WHERE id = ?";
    await client.execute(updateQuery, ['student', 'active', userId], { prepare: true });
    console.log("✅ Updated user with role and status");

    // Add to student table
    const checkStudentQuery = "SELECT email FROM student WHERE email = ? ALLOW FILTERING";
    const studentResult = await client.execute(checkStudentQuery, [email], { prepare: true });

    if (studentResult.rowLength === 0) {
      const insertStudentQuery = "INSERT INTO student (email, name, phone_number) VALUES (?, ?, ?)";
      await client.execute(insertStudentQuery, [email, 'Test Student', '+1234567890'], { prepare: true });
      console.log("✅ Added student to student table");
    } else {
      console.log("ℹ️  Student already exists in student table");
    }

    // Verify the user was updated
    const verifyQuery = "SELECT * FROM users WHERE email = ? ALLOW FILTERING";
    const result = await client.execute(verifyQuery, [email], { prepare: true });
    
    if (result.rowLength > 0) {
      const user = result.rows[0];
      console.log("✅ User verification successful:");
      console.log("   - Email:", user.email);
      console.log("   - Name:", user.name);
      console.log("   - Role:", user.role);
      console.log("   - Status:", user.status);
    }

  } catch (error) {
    console.error("❌ Error fixing student user:", error);
  } finally {
    await client.shutdown();
    console.log("🔌 Database connection closed");
  }
}

fixStudentUser();
