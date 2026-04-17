const cassandra = require('cassandra-driver');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

// Initialize Cassandra client
const cloud = { secureConnectBundle: "./secure-connect-gogrowsmart.zip" };
const authProvider = new cassandra.auth.PlainTextAuthProvider('token', process.env.ASTRA_TOKEN);
const credentials = {
  username: process.env.ASTRA_DB_USERNAME,
  password: process.env.ASTRA_DB_PASSWORD
};

const client = new cassandra.Client({
  cloud,
  authProvider,
  credentials,
  keyspace: process.env.ASTRA_DB_KEYSPACE
});

const testTeachers = [
  {
    email: 'teacher31@example.com',
    name: 'Test Teacher 31',
    phoneNumber: '+919876543131',
    role: 'teacher'
  },
  {
    email: 'teacher56@example.com',
    name: 'Test Teacher 56',
    phoneNumber: '+919876543156',
    role: 'teacher'
  }
];

async function addTestTeachers() {
  try {
    await client.connect();
    console.log('✅ Connected to AstraDB');

    for (const teacher of testTeachers) {
      console.log(`\n📝 Processing ${teacher.email}...`);

      // Check if user exists
      const checkUserQuery = "SELECT email FROM users WHERE email = ? ALLOW FILTERING";
      const userResult = await client.execute(checkUserQuery, [teacher.email], { prepare: true });

      if (userResult.rowLength === 0) {
        // Create user in users table
        const userId = uuidv4();
        const insertUserQuery = `
          INSERT INTO users (id, email, name, phonenumber, role, status, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        await client.execute(insertUserQuery, [
          userId,
          teacher.email,
          teacher.name,
          teacher.phoneNumber,
          teacher.role,
          'active',
          new Date()
        ], { prepare: true });
        console.log(`✅ Created user: ${teacher.email}`);
      } else {
        console.log(`ℹ️  User already exists: ${teacher.email}`);
      }

      // Check if teacher exists in teachers1 table
      const checkTeacherQuery = "SELECT email FROM teachers1 WHERE email = ? ALLOW FILTERING";
      const teacherResult = await client.execute(checkTeacherQuery, [teacher.email], { prepare: true });

      if (teacherResult.rowLength === 0) {
        // Create teacher in teachers1 table
        const insertTeacherQuery = `
          INSERT INTO teachers1 (email, name)
          VALUES (?, ?)
        `;
        await client.execute(insertTeacherQuery, [teacher.email, teacher.name], { prepare: true });
        console.log(`✅ Created teacher record: ${teacher.email}`);
      } else {
        console.log(`ℹ️  Teacher record already exists: ${teacher.email}`);
      }

      // Check if teacher exists in tutors table (for registration data)
      const checkTutorQuery = "SELECT email FROM tutors WHERE email = ? ALLOW FILTERING";
      const tutorResult = await client.execute(checkTutorQuery, [teacher.email], { prepare: true });

      if (tutorResult.rowLength === 0) {
        // Create minimal tutor record
        const tutorId = uuidv4();
        const insertTutorQuery = `
          INSERT INTO tutors (
            id, email, full_name, phone_number, specialization, experience, country, state
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await client.execute(insertTutorQuery, [
          tutorId,
          teacher.email,
          teacher.name,
          teacher.phoneNumber,
          'Mathematics',
          '5',
          'India',
          'Karnataka'
        ], { prepare: true });
        console.log(`✅ Created tutor record: ${teacher.email}`);
      } else {
        console.log(`ℹ️  Tutor record already exists: ${teacher.email}`);
      }
    }

    console.log('\n✅ All test teachers added successfully!');
  } catch (error) {
    console.error('❌ Error adding test teachers:', error);
  } finally {
    await client.shutdown();
  }
}

addTestTeachers();
