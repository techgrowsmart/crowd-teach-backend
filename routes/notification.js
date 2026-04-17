const express = require('express');
const router = express.Router();
const cors = require('cors');
const notificationController = require('../controllers/notificationController');
const verifyToken = require('../utils/verifyToken');

// Enable CORS for all notification routes
router.use(cors());

// Get notifications for current user based on their role
router.get('/notifications', verifyToken, notificationController.getNotifications);

// Get count of unread notifications
router.get('/notifications/unread-count', verifyToken, notificationController.getUnreadCount);

// Add new notification (with role targeting)
router.post('/notifications', verifyToken, notificationController.addNotification);

// Mark notification as read
router.post('/notifications/mark-read', verifyToken, notificationController.markAsRead);

module.exports = router;