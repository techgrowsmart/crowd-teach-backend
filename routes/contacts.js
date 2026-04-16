const express = require('express');
const router = express.Router();
const verifyToken = require('../utils/verifyToken');
const mongoose = require('mongoose');

// Contact/Connection Schema
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

const Contact = mongoose.model('Contact', ContactSchema);

// Get contacts for a user (GET method)
router.get('/contacts', verifyToken, async (req, res) => {
  try {
    const userEmail = req.user.email;
    const { type } = req.query; // Support type=teacher parameter
    
    const contacts = await Contact.find({
      $or: [
        { requesterEmail: userEmail },
        { recipientEmail: userEmail }
      ],
      status: 'accepted'
    })
    .sort({ updatedAt: -1 })
    .limit(50);
    
    // Import Cassandra client safely
    let client = null;
    try {
      client = require('../config/db');
    } catch (dbError) {
      console.log('⚠️ Cassandra client not available:', dbError.message);
    }
    
    // If type is 'teacher', filter for students who have made payments
    if (type === 'teacher' && client) {
      try {
        const formattedContacts = [];
        for (const contact of contacts) {
          const isRequester = contact.requesterEmail === userEmail;
          const contactName = isRequester ? (contact.recipientName || 'Unknown') : (contact.requesterName || 'Unknown');
          const contactEmail = isRequester ? contact.recipientEmail : contact.requesterEmail;
          
          let hasPaid = false;
          try {
            // Check wallet_transactions for payments
            const paymentQuery = 'SELECT COUNT(*) as payment_count FROM wallet_transactions WHERE email = ? ALLOW FILTERING';
            const paymentResult = await client.execute(paymentQuery, [contactEmail], { prepare: true });
            hasPaid = paymentResult.rowLength > 0 && paymentResult.rows[0].payment_count > 0;
          } catch (paymentError) {
            // If query fails, assume student has access
            console.log('⚠️ Payment check failed for', contactEmail, ':', paymentError.message);
            hasPaid = true;
          }
          
          // Only add if student has made at least one payment
          if (hasPaid) {
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
        }
        
        return res.json({
          success: true,
          contacts: formattedContacts
        });
      } catch (dbError) {
        console.error('⚠️ Cassandra query error:', dbError);
        // Fall back to returning all contacts if payment check fails
      }
    }
    
    // Return all contacts (for students or if payment check failed)
    const formattedContacts = contacts.map(contact => ({
      id: contact._id.toString(),
      studentName: contact.requesterEmail === userEmail ? contact.recipientName : contact.requesterName,
      studentEmail: contact.requesterEmail === userEmail ? contact.recipientEmail : contact.requesterEmail,
      studentProfilePic: null,
      lastMessage: contact.message || 'No messages yet',
      lastMessageTime: contact.updatedAt ? new Date(contact.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now',
      status: contact.status
    }));
    
    res.json({
      success: true,
      contacts: formattedContacts
    });
  } catch (error) {
    console.error('❌ Error fetching contacts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch contacts'
    });
  }
});

// Check connection request status between student and teacher
router.post('/check-connection-status', verifyToken, async (req, res) => {
  try {
    const { studentEmail, teacherEmail } = req.body;
    const tokenEmail = req.user.email;

    // Use email from body or fall back to token
    const student = studentEmail || tokenEmail;

    if (!teacherEmail) {
      return res.status(400).json({
        success: false,
        message: 'Teacher email is required'
      });
    }

    // Check for existing connection request
    const connection = await Contact.findOne({
      $or: [
        { requesterEmail: student, recipientEmail: teacherEmail },
        { requesterEmail: teacherEmail, recipientEmail: student }
      ]
    }).sort({ createdAt: -1 });

    if (connection) {
      res.json({
        success: true,
        status: connection.status,
        requestId: connection._id.toString(),
        createdAt: connection.createdAt
      });
    } else {
      res.json({
        success: true,
        status: null,
        requestId: null
      });
    }
  } catch (error) {
    console.error('Error checking connection status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check connection status'
    });
  }
});

// Get contacts for a user (POST method - for frontend compatibility)
router.post('/contacts', verifyToken, async (req, res) => {
  try {
    const { userEmail, type } = req.body;
    const tokenEmail = req.user.email;

    // Use email from body or fall back to token
    const email = userEmail || tokenEmail;

    const contacts = await Contact.find({
      $or: [
        { requesterEmail: email },
        { recipientEmail: email }
      ],
      status: 'accepted'
    })
    .sort({ updatedAt: -1 })
    .limit(50);

    // Format contacts to match techgrowsmart frontend expectations
    const formattedContacts = [];
    
    // Import Cassandra client safely
    let client = null;
    try {
      client = require('../config/db');
    } catch (dbError) {
      console.log('⚠️ Cassandra client not available:', dbError.message);
    }
    
    for (const contact of contacts) {
      const isRequester = contact.requesterEmail === email;
      const contactName = isRequester ? (contact.recipientName || 'Unknown') : (contact.requesterName || 'Unknown');
      const contactEmail = isRequester ? contact.recipientEmail : contact.requesterEmail;

      // If type is 'teacher', try to check wallet_transactions for payments
      if (type === 'teacher') {
        let hasPaid = false;
        
        // Only check payments if Cassandra client is available
        if (client) {
          try {
            // Check wallet_transactions for payments
            const paymentQuery = 'SELECT COUNT(*) as payment_count FROM wallet_transactions WHERE email = ? ALLOW FILTERING';
            const paymentResult = await client.execute(paymentQuery, [contactEmail], { prepare: true });
            hasPaid = paymentResult.rowLength > 0 && paymentResult.rows[0].payment_count > 0;
          } catch (cassandraError) {
            // If table doesn't exist or query fails, assume student has access (fallback)
            console.log('⚠️ Payment check failed for', contactEmail, ':', cassandraError.message);
            hasPaid = true; // Allow access if we can't verify payments
          }
        } else {
          // If no Cassandra, allow all contacts
          hasPaid = true;
        }

        // Only add if student has made at least one payment (or if payment check failed)
        if (hasPaid) {
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
      } else {
        // For students, show all teachers
        formattedContacts.push({
          id: contact._id.toString(),
          teacherName: contactName,
          teacherEmail: contactEmail,
          teacherProfilePic: null,
          lastMessage: contact.message || 'No messages yet',
          lastMessageTime: contact.updatedAt ? new Date(contact.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now',
          status: contact.status
        });
      }
    }

    res.json({
      success: true,
      contacts: formattedContacts
    });
  } catch (error) {
    console.error('❌ Error fetching contacts:', error);
    console.error('Stack:', error.stack);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch contacts',
      error: error.message
    });
  }
});

// Get pending connection requests
router.get('/contacts/pending', verifyToken, async (req, res) => {
  try {
    const userEmail = req.user.email;
    
    const pendingRequests = await Contact.find({
      recipientEmail: userEmail,
      status: 'pending'
    })
    .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      pendingRequests: pendingRequests
    });
  } catch (error) {
    console.error('Error fetching pending requests:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending requests'
    });
  }
});

// Send connection request
router.post('/contacts', verifyToken, async (req, res) => {
  try {
    const { recipientEmail, message } = req.body;
    const requesterEmail = req.user.email;
    const requesterName = req.user.name || requesterEmail.split('@')[0];
    
    if (!recipientEmail) {
      return res.status(400).json({
        success: false,
        message: 'Recipient email is required'
      });
    }
    
    if (recipientEmail === requesterEmail) {
      return res.status(400).json({
        success: false,
        message: 'Cannot send connection request to yourself'
      });
    }
    
    // Check if connection already exists
    const existingContact = await Contact.findOne({
      $or: [
        { requesterEmail, recipientEmail },
        { requesterEmail: recipientEmail, recipientEmail: requesterEmail }
      ]
    });
    
    if (existingContact) {
      return res.status(400).json({
        success: false,
        message: 'Connection already exists or pending'
      });
    }
    
    // Get recipient name (you might need to query user collection here)
    const recipientName = recipientEmail.split('@')[0];
    
    const newContact = new Contact({
      requesterEmail,
      recipientEmail,
      requesterName,
      recipientName,
      message: message || '',
      status: 'pending'
    });
    
    await newContact.save();
    
    res.status(201).json({
      success: true,
      message: 'Connection request sent successfully',
      contact: newContact
    });
  } catch (error) {
    console.error('Error sending connection request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send connection request'
    });
  }
});

// Accept connection request
router.put('/contacts/:contactId/accept', verifyToken, async (req, res) => {
  try {
    const { contactId } = req.params;
    const userEmail = req.user.email;
    
    const contact = await Contact.findOne({
      _id: contactId,
      recipientEmail: userEmail,
      status: 'pending'
    });
    
    if (!contact) {
      return res.status(404).json({
        success: false,
        message: 'Connection request not found'
      });
    }
    
    contact.status = 'accepted';
    contact.updatedAt = new Date();
    await contact.save();
    
    res.json({
      success: true,
      message: 'Connection request accepted',
      contact: contact
    });
  } catch (error) {
    console.error('Error accepting connection request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to accept connection request'
    });
  }
});

// Reject connection request
router.put('/contacts/:contactId/reject', verifyToken, async (req, res) => {
  try {
    const { contactId } = req.params;
    const userEmail = req.user.email;
    
    const contact = await Contact.findOne({
      _id: contactId,
      recipientEmail: userEmail,
      status: 'pending'
    });
    
    if (!contact) {
      return res.status(404).json({
        success: false,
        message: 'Connection request not found'
      });
    }
    
    contact.status = 'rejected';
    contact.updatedAt = new Date();
    await contact.save();
    
    res.json({
      success: true,
      message: 'Connection request rejected',
      contact: contact
    });
  } catch (error) {
    console.error('Error rejecting connection request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject connection request'
    });
  }
});

module.exports = router;
