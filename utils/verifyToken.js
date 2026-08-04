const jwt = require('jsonwebtoken');

const verifyToken = (req, res, next) => {
    // Debug logging
    console.log('🔍 Auth Debug - Headers:', Object.keys(req.headers));
    console.log('🔍 Auth Debug - Authorization Header:', req.headers.authorization);
    console.log('🔍 Auth Debug - JWT_SECRET_KEY exists:', !!process.env.JWT_SECRET_KEY);
    
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(" ")[1];

    if (!token) {
        console.log('❌ No token provided');
        return res.status(401).json({ message: 'No token provided' });
    }

    console.log('🔍 Token extracted:', token.substring(0, 20) + '...');

    jwt.verify(token, process.env.JWT_SECRET_KEY, (err, decoded) => {
        if (err) {
            console.log('❌ JWT verification failed:', err.message);
            console.log('❌ JWT error name:', err.name);
            console.log('❌ Token was:', token);
            
            // More specific error messages
            if (err.name === 'TokenExpiredError') {
                return res.status(403).json({ message: 'Token expired' });
            } else if (err.name === 'JsonWebTokenError') {
                return res.status(403).json({ message: 'Invalid token format' });
            } else if (err.name === 'NotBeforeError') {
                return res.status(403).json({ message: 'Token not active' });
            } else {
                return res.status(403).json({ message: 'Failed to authenticate token' });
            }
        }

        console.log('✅ Token verified successfully for user:', decoded.email);
        req.user = decoded; // Add decoded payload to request
        next();
    });
};

module.exports = verifyToken;
