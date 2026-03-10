const express = require('express');
const router = express.Router();
const verifyToken = require('../utils/verifyToken');
const cache = require('../middleware/cache');

// Test endpoint without authentication - CACHED
router.get('/public', cache.cachePublic(), (req, res) => {
    res.json({
        message: 'This is a public endpoint - no auth required',
        timestamp: new Date().toISOString(),
        cached: false
    });
});

// Test endpoint with authentication - USER CACHED
router.get('/protected', verifyToken, cache.cacheUser(), (req, res) => {
    res.json({
        message: 'This is a protected endpoint - auth required',
        user: req.user,
        timestamp: new Date().toISOString(),
        cached: false
    });
});

// Test endpoint to check if token is stored properly
router.post('/check-token', async (req, res) => {
    try {
        const { token } = req.body;
        
        if (!token) {
            return res.status(400).json({ message: 'Token is required' });
        }
        
        // Try to verify the token
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
        
        res.json({
            message: 'Token is valid',
            decoded: decoded,
            expiresAt: new Date(decoded.exp * 1000).toISOString()
        });
        
    } catch (error) {
        res.status(403).json({
            message: 'Token verification failed',
            error: error.message,
            errorName: error.name
        });
    }
});

module.exports = router;
