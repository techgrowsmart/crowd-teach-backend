const express = require('express');
const router = express.Router();
const cors = require('cors');
const notificationController = require('../controllers/notificationController');
const verifyToken = require('../utils/verifyToken');

// CORS configuration matching global app.js
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return callback(null, true);
    }
    if (origin.includes('gogrowsmart.com') || origin.endsWith('.gogrowsmart.com')) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'X-Test-User'],
  credentials: true,
  maxAge: 86400,
  preflightContinue: false,
  optionsSuccessStatus: 204
};

router.use(cors(corsOptions));
router.options('*', cors(corsOptions));

// Get notifications for current user based on their role
router.get('/notifications', verifyToken, notificationController.getNotifications);

// Get count of unread notifications
router.get('/notifications/unread-count', cors(corsOptions), verifyToken, notificationController.getUnreadCount);

// Add new notification (with role targeting)
router.post('/notifications', verifyToken, notificationController.addNotification);

// Mark notification as read
router.post('/notifications/mark-read', verifyToken, notificationController.markAsRead);

module.exports = router;