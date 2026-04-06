const nodemailer = require("nodemailer");
require('dotenv').config();

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || "smtp.hostinger.com",
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: parseInt(process.env.EMAIL_PORT) === 465, // true for 465, false for 587
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
    tls: {
        rejectUnauthorized: false // Allow self-signed certificates
    },
    debug: true, // Enable debug output
    logger: true // Log information to console
});

// Verify connection on startup
transporter.verify((error, success) => {
    if (error) {
        console.error('❌ Email transporter verification failed:', error);
        console.log('🔧 Email will fallback to console OTP display');
    } else {
        console.log('✅ Email transporter is ready to send messages');
    }
});

module.exports = transporter;
