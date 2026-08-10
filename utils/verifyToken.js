const jwt = require('jsonwebtoken');

const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(" ")[1];

    if (!token) {
        return res.status(401).json({ message: 'No token provided' });
    }

    jwt.verify(token, process.env.JWT_SECRET_KEY, (err, decoded) => {
        if (err) {
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

        req.user = decoded;
        next();
    });
};

module.exports = verifyToken;
