const jwt = require('jsonwebtoken');

// Use the EXACT JWT secret from .env
const JWT_SECRET = 'someVeryStrongRandomSecretKey';

// Generate real JWT tokens for testing with the correct secret
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

console.log('🔑 CORRECT JWT TOKENS WITH EXACT SECRET:');
console.log('\n📚 Student Token (copy this):');
console.log(studentToken);
console.log('\n👨‍🏫 Teacher Token (copy this):');
console.log(teacherToken);

// Verify the tokens work with the exact secret
console.log('\n✅ Verifying tokens with exact secret...');
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

console.log('\n📋 READY TO COPY INTO LOGIN.tsx:');
console.log('\nStudent:');
console.log('const realToken = "' + studentToken + '";');
console.log('\nTeacher:');
console.log('const realToken = "' + teacherToken + '";');
