const express = require('express');
const router = express.Router();
const verifyToken = require('../utils/verifyToken');
const { getIO } = require('../socket');
const client = require('../config/db');

// Booking requests storage - in-memory cache, also persisted to Cassandra
const bookingRequests = new Map();

// Create booking_requests table in Cassandra (if not exists)
const initBookingTable = async (client) => {
  try {
    await client.execute(`
      CREATE TABLE IF NOT EXISTS booking_requests (
        id TEXT PRIMARY KEY,
        student_email TEXT,
        student_name TEXT,
        teacher_email TEXT,
        subject TEXT,
        class_name TEXT,
        charge DECIMAL,
        status TEXT,
        created_at TIMESTAMP,
        updated_at TIMESTAMP,
        student_info TEXT,
        teacher_response TEXT
      )
    `);
    console.log('✅ booking_requests table initialized');
  } catch (error) {
    console.error('❌ Error creating booking_requests table:', error);
  }
};

// POST /api/bookings/request - Student creates a booking request
router.post('/request', verifyToken, async (req, res) => {
  try {
    const { teacherEmail, subject, className, charge, studentInfo } = req.body;
    const studentEmail = req.user.email;
    const studentName = req.user.name;

    if (!teacherEmail || !subject) {
      return res.status(400).json({ 
        success: false, 
        message: 'Teacher email and subject are required' 
      });
    }

    // Check for existing pending request for same student-teacher-subject combination
    const existingRequest = Array.from(bookingRequests.values()).find(
      b => b.studentEmail === studentEmail &&
           b.teacherEmail === teacherEmail &&
           b.subject === subject &&
           b.className === (className || '') &&
           b.status === 'pending'
    );

    if (existingRequest) {
      return res.status(400).json({
        success: false,
        message: 'You already have a pending request for this class. Please wait for the teacher to respond.',
        existingBooking: existingRequest
      });
    }

    // Create booking request
    const bookingId = `booking_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const bookingRequest = {
      id: bookingId,
      studentEmail,
      studentName,
      teacherEmail,
      subject,
      className: className || '',
      charge: charge || 0,
      status: 'pending',
      timestamp: new Date().toISOString(),
      studentInfo: studentInfo || {}
    };

    // Store in memory cache
    bookingRequests.set(bookingId, bookingRequest);

    // Store in Cassandra database for persistence
    try {
      const insertQuery = `
        INSERT INTO booking_requests (
          id, student_email, student_name, teacher_email, subject, class_name,
          charge, status, created_at, updated_at, student_info, teacher_response
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      await client.execute(insertQuery, [
        bookingId,
        studentEmail,
        studentName,
        teacherEmail,
        subject,
        className || '',
        charge || 0,
        'pending',
        new Date(),
        new Date(),
        JSON.stringify(studentInfo || {}),
        ''
      ], { prepare: true });
      console.log('✅ Booking request stored in Cassandra:', bookingId);
    } catch (dbError) {
      console.error('❌ Error storing booking in Cassandra:', dbError);
      // Don't fail the request if DB write fails, in-memory still works
    }

    // Notify teacher via WebSocket
    try {
      const io = getIO();
      io.to(`user:${teacherEmail}`).emit('new_booking_request', bookingRequest);
      console.log(`📨 Real-time notification sent to teacher: ${teacherEmail}`);
    } catch (socketError) {
      console.error('Socket notification failed:', socketError);
      // Don't fail the request if socket fails
    }

    res.status(201).json({
      success: true,
      message: 'Booking request sent successfully',
      booking: bookingRequest
    });
  } catch (error) {
    console.error('Error creating booking request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create booking request'
    });
  }
});

// GET /api/bookings/teacher-requests - Get all requests for a teacher
router.get('/teacher-requests', verifyToken, async (req, res) => {
  try {
    const teacherEmail = req.user.email;

    // Try to fetch from Cassandra first
    try {
      const query = 'SELECT * FROM booking_requests WHERE teacher_email = ? ALLOW FILTERING';
      const result = await client.execute(query, [teacherEmail], { prepare: true });

      if (result.rows && result.rows.length > 0) {
        const requests = result.rows.map(row => ({
          id: row.id,
          studentEmail: row.student_email,
          studentName: row.student_name,
          teacherEmail: row.teacher_email,
          subject: row.subject,
          className: row.class_name,
          charge: row.charge,
          status: row.status,
          timestamp: row.created_at,
          studentInfo: row.student_info ? JSON.parse(row.student_info) : {},
          teacherResponse: row.teacher_response
        }));

        // Update in-memory cache
        requests.forEach(req => bookingRequests.set(req.id, req));

        return res.json({
          success: true,
          requests: requests.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        });
      }
    } catch (dbError) {
      console.error('Error fetching from Cassandra, falling back to memory:', dbError);
    }

    // Fallback to in-memory storage
    const requests = Array.from(bookingRequests.values())
      .filter(b => b.teacherEmail === teacherEmail)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({
      success: true,
      requests: requests
    });
  } catch (error) {
    console.error('Error fetching teacher requests:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch requests'
    });
  }
});

// GET /api/bookings/student-requests - Get all requests by a student
router.get('/student-requests', verifyToken, async (req, res) => {
  try {
    const studentEmail = req.user.email;

    // Try to fetch from Cassandra first
    try {
      const query = 'SELECT * FROM booking_requests WHERE student_email = ? ALLOW FILTERING';
      const result = await client.execute(query, [studentEmail], { prepare: true });

      if (result.rows && result.rows.length > 0) {
        const requests = result.rows.map(row => ({
          id: row.id,
          studentEmail: row.student_email,
          studentName: row.student_name,
          teacherEmail: row.teacher_email,
          subject: row.subject,
          className: row.class_name,
          charge: row.charge,
          status: row.status,
          timestamp: row.created_at,
          studentInfo: row.student_info ? JSON.parse(row.student_info) : {},
          teacherResponse: row.teacher_response
        }));

        // Update in-memory cache
        requests.forEach(req => bookingRequests.set(req.id, req));

        return res.json({
          success: true,
          requests: requests.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        });
      }
    } catch (dbError) {
      console.error('Error fetching from Cassandra, falling back to memory:', dbError);
    }

    // Fallback to in-memory storage
    const requests = Array.from(bookingRequests.values())
      .filter(b => b.studentEmail === studentEmail)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({
      success: true,
      requests: requests
    });
  } catch (error) {
    console.error('Error fetching student requests:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch requests'
    });
  }
});

// PUT /api/bookings/respond - Teacher responds to a booking request OR student marks as subscribed after payment
router.put('/respond', verifyToken, async (req, res) => {
  try {
    const { bookingId, status, message } = req.body;
    const userEmail = req.user.email;
    const userName = req.user.name;
    const userRole = req.user.role;

    if (!bookingId || !status) {
      return res.status(400).json({
        success: false,
        message: 'Booking ID and status are required'
      });
    }

    if (!['accepted', 'rejected', 'subscribed'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status must be "accepted", "rejected", or "subscribed"'
      });
    }

    // Get the booking request
    const booking = bookingRequests.get(bookingId);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking request not found'
      });
    }

    // Verify the user is authorized (teacher who owns the request OR student who made the request for 'subscribed' status)
    const isTeacher = booking.teacherEmail === userEmail;
    const isStudent = booking.studentEmail === userEmail;
    const isSubscribedStatus = status === 'subscribed';

    // Allow students to only mark as 'subscribed' (after payment)
    // Allow teachers to accept, reject, or mark as subscribed
    if (!isTeacher && !(isStudent && isSubscribedStatus)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to respond to this request'
      });
    }

    // Update booking status in memory
    booking.status = status;
    booking.teacherResponse = message || `Teacher has ${status} your request`;
    booking.updatedAt = new Date().toISOString();
    booking.teacherName = userName;

    // Update in Cassandra database
    try {
      const updateQuery = `
        UPDATE booking_requests
        SET status = ?, updated_at = ?, teacher_response = ?
        WHERE id = ?
      `;
      await client.execute(updateQuery, [status, new Date(), message || '', bookingId], { prepare: true });
      console.log('✅ Booking status updated in Cassandra:', bookingId, status);
    } catch (dbError) {
      console.error('❌ Error updating booking in Cassandra:', dbError);
      // Don't fail the request if DB update fails, in-memory still works
    }

    // Notify student via WebSocket
    try {
      const io = getIO();
      io.to(`user:${booking.studentEmail}`).emit('booking_status_update', {
        bookingId: bookingId,
        teacherEmail: userEmail,
        teacherName: userName,
        status: status,
        message: booking.teacherResponse,
        timestamp: booking.updatedAt,
        subject: booking.subject,
        className: booking.className
      });
      console.log(`✅ Real-time status update sent to student: ${booking.studentEmail}`);
    } catch (socketError) {
      console.error('Socket notification failed:', socketError);
    }

    res.json({
      success: true,
      message: `Request ${status} successfully`,
      booking: booking
    });
  } catch (error) {
    console.error('Error responding to booking request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to respond to request'
    });
  }
});

// GET /api/bookings/status/:bookingId - Get status of a specific booking
router.get('/status/:bookingId', verifyToken, async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userEmail = req.user.email;

    const booking = bookingRequests.get(bookingId);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking request not found'
      });
    }

    // Verify user is either the student or teacher for this booking
    if (booking.studentEmail !== userEmail && booking.teacherEmail !== userEmail) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this booking'
      });
    }

    res.json({
      success: true,
      booking: booking
    });
  } catch (error) {
    console.error('Error fetching booking status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch booking status'
    });
  }
});

// DELETE /api/bookings/:bookingId - Cancel a booking request (student only)
router.delete('/:bookingId', verifyToken, async (req, res) => {
  try {
    const { bookingId } = req.params;
    const studentEmail = req.user.email;

    const booking = bookingRequests.get(bookingId);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking request not found'
      });
    }

    // Verify the student owns this request
    if (booking.studentEmail !== studentEmail) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to cancel this request'
      });
    }

    // Only allow cancellation of pending requests
    if (booking.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel a ${booking.status} request`
      });
    }

    booking.status = 'cancelled';
    booking.updatedAt = new Date().toISOString();

    // Notify teacher
    try {
      const io = getIO();
      io.to(`user:${booking.teacherEmail}`).emit('booking_cancelled', {
        bookingId: bookingId,
        studentEmail: studentEmail,
        message: 'Student cancelled the request'
      });
    } catch (socketError) {
      console.error('Socket notification failed:', socketError);
    }

    res.json({
      success: true,
      message: 'Booking request cancelled'
    });
  } catch (error) {
    console.error('Error cancelling booking:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel booking'
    });
  }
});

// POST /api/bookings/check-status - Check booking status between student and teacher
router.post('/check-status', verifyToken, async (req, res) => {
  try {
    const { studentEmail, teacherEmail, subject, className } = req.body;
    const tokenEmail = req.user.email;

    // Use email from body or fall back to token
    const student = studentEmail || tokenEmail;

    if (!teacherEmail) {
      return res.status(400).json({
        success: false,
        message: 'Teacher email is required'
      });
    }

    console.log(`🔍 Checking booking status: student=${student}, teacher=${teacherEmail}`);

    // Try to fetch from Cassandra first
    let booking = null;
    try {
      const query = `
        SELECT * FROM booking_requests
        WHERE student_email = ? AND teacher_email = ?
        ALLOW FILTERING
      `;
      const result = await client.execute(query, [student, teacherEmail], { prepare: true });

      if (result.rows && result.rows.length > 0) {
        // Find the most recent matching booking
        const rows = result.rows
          .filter(row => {
            if (subject && row.subject !== subject) return false;
            if (className && row.class_name !== className) return false;
            return true;
          })
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        if (rows.length > 0) {
          const row = rows[0];
          booking = {
            id: row.id,
            studentEmail: row.student_email,
            studentName: row.student_name,
            teacherEmail: row.teacher_email,
            subject: row.subject,
            className: row.class_name,
            charge: row.charge,
            status: row.status,
            timestamp: row.created_at,
            studentInfo: row.student_info ? JSON.parse(row.student_info) : {},
            teacherResponse: row.teacher_response
          };

          // Update in-memory cache
          bookingRequests.set(booking.id, booking);
        }
      }
    } catch (dbError) {
      console.error('Error fetching from Cassandra, falling back to memory:', dbError);
    }

    // Fallback to in-memory storage
    if (!booking) {
      booking = Array.from(bookingRequests.values()).find(
        b => b.studentEmail === student &&
             b.teacherEmail === teacherEmail &&
             (!subject || b.subject === subject) &&
             (!className || b.className === className)
      );
    }

    if (booking) {
      console.log(`✅ Found booking: id=${booking.id}, status=${booking.status}`);
      res.json({
        success: true,
        status: booking.status,
        requestId: booking.id,
        booking: booking
      });
    } else {
      console.log('📋 No booking request found');
      res.json({
        success: true,
        status: null,
        requestId: null
      });
    }
  } catch (error) {
    console.error('Error checking booking status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check booking status'
    });
  }
});

module.exports = { router, initBookingTable, bookingRequests };
