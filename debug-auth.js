const jwt = require('jsonwebtoken');
require('dotenv').config();

console.log('🔍 Debugging JWT Authentication');
console.log('JWT_SECRET_KEY:', process.env.JWT_SECRET_KEY);

// Test token creation and verification
const testPayload = {
  email: 'test@example.com',
  role: 'student',
  name: 'Test User'
};

try {
  // Create token
  const token = jwt.sign(testPayload, process.env.JWT_SECRET_KEY, { expiresIn: '7d' });
  console.log('✅ Token created successfully');
  console.log('Token:', token);
  
  // Verify token
  const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
  console.log('✅ Token verified successfully');
  console.log('Decoded:', decoded);
  
  // Test with wrong secret
  try {
    const wrongDecoded = jwt.verify(token, 'wrong_secret');
    console.log('❌ Should have failed with wrong secret');
  } catch (err) {
    console.log('✅ Correctly failed with wrong secret:', err.message);
  }
  
  // Test malformed token
  try {
    const malformedDecoded = jwt.verify('malformed.token.here', process.env.JWT_SECRET_KEY);
    console.log('❌ Should have failed with malformed token');
  } catch (err) {
    console.log('✅ Correctly failed with malformed token:', err.message);
  }
  
} catch (error) {
  console.error('❌ Error in JWT test:', error);
}

// Test the verifyToken middleware logic
console.log('\n🧪 Testing middleware logic:');

const mockReq = {
  headers: {
    authorization: 'Bearer test_token_here'
  }
};

const mockRes = {
  status: (code) => ({
    json: (data) => {
      console.log(`Response ${code}:`, data);
      return { status: code, json: data };
    }
  })
};

// Simulate middleware
function testVerifyToken(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  console.log('Extracted token:', token ? 'exists' : 'missing');
  
  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }

  jwt.verify(token, process.env.JWT_SECRET_KEY, (err, decoded) => {
    if (err) {
      console.log('JWT Error:', err.message);
      console.log('JWT Error name:', err.name);
      return res.status(403).json({ message: 'Failed to authenticate token' });
    }

    req.user = decoded;
    console.log('✅ Middleware would pass with decoded:', decoded);
    next();
  });
}

// Test with valid token
const validToken = jwt.sign(testPayload, process.env.JWT_SECRET_KEY, { expiresIn: '7d' });
mockReq.headers.authorization = `Bearer ${validToken}`;
console.log('\nTesting with valid token:');
testVerifyToken(mockReq, mockRes, () => console.log('Next called'));

// Test with invalid token
mockReq.headers.authorization = 'Bearer invalid_token';
console.log('\nTesting with invalid token:');
testVerifyToken(mockReq, mockRes, () => console.log('Next called'));

// Test with no token
mockReq.headers.authorization = '';
console.log('\nTesting with no token:');
testVerifyToken(mockReq, mockRes, () => console.log('Next called'));
