require("dotenv").config();
const jwt = require('jsonwebtoken');

// Use the same JWT secret as the backend
const JWT_SECRET = process.env.JWT_SECRET_KEY || 'someVeryStrongRandomSecretKey';

// Generate real JWT tokens for testing
const studentPayload = {
  email: 'student1@example.com',
  role: 'student',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60) // 1 year
};

const teacherPayload = {
  email: 'teacher56@example.com', 
  role: 'teacher',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60) // 1 year
};

const studentToken = jwt.sign(studentPayload, JWT_SECRET);
const teacherToken = jwt.sign(teacherPayload, JWT_SECRET);

console.log('🔑 REAL JWT TOKENS FOR TESTING:');
console.log('\n📚 Student Token (copy this):');
console.log(studentToken);
console.log('\n👨‍🏫 Teacher Token (copy this):');
console.log(teacherToken);

// Verify the tokens work
console.log('\n✅ Verifying tokens...');
try {
  const decodedStudent = jwt.verify(studentToken, JWT_SECRET);
  console.log('✅ Student token valid for:', decodedStudent.email);
} catch (err) {
  console.log('❌ Student token invalid:', err.message);
}

try {
  const decodedTeacher = jwt.verify(teacherToken, JWT_SECRET);
  console.log('✅ Teacher token valid for:', decodedTeacher.email);
} catch (err) {
  console.log('❌ Teacher token invalid:', err.message);
}

console.log('\n📋 POSTMAN REQUEST EXAMPLES:');
console.log('\n1. Get Teachers:');
console.log('POST https://growsmartserver.gogrowsmart.com/api/teachers');
console.log('Headers: Authorization: Bearer ' + studentToken);
console.log('Body: {"count": 10, "page": 1}');

console.log('\n2. Get User Profile:');
console.log('POST https://growsmartserver.gogrowsmart.com/api/userProfile');
console.log('Headers: Authorization: Bearer ' + studentToken);
console.log('Body: {"email": "student1@example.com"}');

console.log('\n3. Get Unread Count:');
console.log('GET https://growsmartserver.gogrowsmart.com/api/notifications/unread-count');
console.log('Headers: Authorization: Bearer ' + studentToken);
