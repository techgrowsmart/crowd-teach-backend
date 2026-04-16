const express = require('express');
const router = express.Router();
const verifyToken = require('../utils/verifyToken');
const mongoose = require('mongoose');

// Contact Schema
const ContactSchema = new mongoose.Schema({
  requesterEmail: { type: String, required: true, index: true },
  recipientEmail: { type: String, required: true, index: true },
  requesterName: { type: String, required: true },
  recipientName: { type: String, required: true },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected'],
    default: 'pending',
    index: true
  },
  message: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Check if model already exists to prevent overwrite error
const Contact = mongoose.models.Contact || mongoose.model('Contact', ContactSchema);

// GET /api/teacher/contacts - Fetch teacher's contacts/students
router.get('/contacts', verifyToken, async (req, res) => {
  try {
    const teacherEmail = req.user.email;

    const contacts = await Contact.find({
      $or: [
        { requesterEmail: teacherEmail },
        { recipientEmail: teacherEmail }
      ],
      status: 'accepted'
    })
    .sort({ updatedAt: -1 })
    .limit(50);

    const formattedContacts = [];
    for (const contact of contacts) {
      const isRequester = contact.requesterEmail === teacherEmail;
      const contactName = isRequester ? (contact.recipientName || 'Unknown') : (contact.requesterName || 'Unknown');
      const contactEmail = isRequester ? contact.recipientEmail : contact.requesterEmail;

      formattedContacts.push({
        id: contact._id.toString(),
        studentName: contactName,
        studentEmail: contactEmail,
        studentProfilePic: null,
        lastMessage: contact.message || 'No messages yet',
        lastMessageTime: contact.updatedAt ? new Date(contact.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now',
        status: contact.status
      });
    }

    res.json({
      success: true,
      contacts: formattedContacts
    });
  } catch (error) {
    console.error('Error fetching teacher contacts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch contacts'
    });
  }
});

module.exports = router;
