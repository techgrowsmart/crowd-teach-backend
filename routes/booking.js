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
        board_or_university TEXT,
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

  try {
    await client.execute(`
      CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY,
        teacher_email TEXT,
        student_email TEXT,
        teacher_name TEXT,
        student_name TEXT,
        teacher_profile_pic TEXT,
        student_profile_pic TEXT,
        subject TEXT,
        class_name TEXT,
        board_or_university TEXT,
        title TEXT,
        status TEXT,
        created_at TIMESTAMP,
        updated_at TIMESTAMP
      )
    `);
    console.log('✅ contacts table initialized');

    // Ensure the title column exists on already-created tables (no-op if it already exists)
    try {
      await client.execute(`ALTER TABLE contacts ADD title TEXT`);
      console.log('✅ Added title column to contacts table');
    } catch (alterError) {
      // Column likely already exists - safe to ignore
    }
  } catch (error) {
    console.error('❌ Error creating contacts table:', error);
  }
};

// POST /api/bookings/request - Student creates a booking request
router.post('/request', verifyToken, async (req, res) => {
  try {
    const { teacherEmail, subject, className, boardOrUniversity, charge, studentInfo } = req.body;
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
           b.boardOrUniversity === (boardOrUniversity || '') &&
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
      boardOrUniversity: boardOrUniversity || '',
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
          board_or_university, charge, status, created_at, updated_at, student_info, teacher_response
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      await client.execute(insertQuery, [
        bookingId,
        studentEmail,
        studentName,
        teacherEmail,
        subject,
        className || '',
        boardOrUniversity || '',
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
        // Fetch student profile data for each booking request
        const requestsWithProfiles = await Promise.all(
          result.rows.map(async (row) => {
            let studentInfo = {};
            
            // Always try to fetch student profile data from users table first, then students table
            try {
              let studentResult = null;
              let profileSource = '';
              
              // First try to get from users table
              const userQuery = `
                SELECT name, profileimage
                FROM users 
                WHERE email = ? LIMIT 1
              `;
              studentResult = await client.execute(userQuery, [row.student_email], { prepare: true });
              profileSource = 'users';
              
              // If not found in users table, try students table
              if (!studentResult.rows || studentResult.rows.length === 0) {
                console.log('🔍 User not found, querying students table for:', row.student_email);
                const studentQuery = `
                  SELECT name, profilepic, profile_pic, profileImage, profile_image, profileimage
                  FROM students 
                  WHERE email = ? LIMIT 1
                `;
                studentResult = await client.execute(studentQuery, [row.student_email], { prepare: true });
                profileSource = 'students';
              }
              
              if (studentResult.rows && studentResult.rows.length > 0) {
                const studentRow = studentResult.rows[0];
                
                if (profileSource === 'users') {
                  studentInfo = {
                    name: studentRow.name || row.student_name || row.student_email?.split('@')[0] || 'Student',
                    profilePic: studentRow.profileimage || null
                  };
                } else {
                  studentInfo = {
                    name: studentRow.name || row.student_name || row.student_email?.split('@')[0] || 'Student',
                    profilePic: studentRow.profilepic || 
                               studentRow.profile_pic || 
                               studentRow.profileImage || 
                               studentRow.profile_image || 
                               studentRow.profileimage || 
                               null
                  };
                }
              } else {
                // Fallback to basic info
                studentInfo = {
                  name: row.student_name || row.student_email?.split('@')[0] || 'Student',
                  profilePic: null
                };
              }
            } catch (studentError) {
              console.error('❌ Error fetching student profile:', studentError);
              // Fallback to basic info
              studentInfo = {
                name: row.student_name || row.student_email?.split('@')[0] || 'Student',
                profilePic: null
              };
            }
            
            return {
              id: row.id,
              studentEmail: row.student_email,
              studentName: studentInfo.name || row.student_name,
              teacherEmail: row.teacher_email,
              subject: row.subject,
              className: row.class_name,
              charge: row.charge,
              status: row.status,
              timestamp: row.created_at,
              studentInfo: studentInfo,
              teacherResponse: row.teacher_response
            };
          })
        );

        // Update in-memory cache
        requestsWithProfiles.forEach(req => bookingRequests.set(req.id, req));

        return res.json({
          success: true,
          requests: requestsWithProfiles.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        });
      }
    } catch (dbError) {
      console.error('Error fetching from Cassandra, falling back to memory:', dbError);
    }

    // Fallback to in-memory storage
    const requests = Array.from(bookingRequests.values())
      .filter(b => b.teacherEmail === teacherEmail)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // For fallback, also try to fetch student profiles if they don't exist
    const requestsWithProfiles = await Promise.all(
      requests.map(async (req) => {
        if (req.studentInfo && req.studentInfo.profilePic) {
          return req; // Already has profile data
        }
        
        // Try to fetch student profile data from users table first, then students table
        try {
          let studentResult = null;
          let profileSource = '';
          
          // First try to get from users table
          const userQuery = `
            SELECT name, profileimage
            FROM users 
            WHERE email = ? LIMIT 1
          `;
          studentResult = await client.execute(userQuery, [req.studentEmail], { prepare: true });
          profileSource = 'users';
          
          // If not found in users table, try students table
          if (!studentResult.rows || studentResult.rows.length === 0) {
            const studentQuery = `
              SELECT name, profilepic, profile_pic, profileImage, profile_image, profileimage
              FROM students 
              WHERE email = ? LIMIT 1
            `;
            studentResult = await client.execute(studentQuery, [req.studentEmail], { prepare: true });
            profileSource = 'students';
          }
          
          if (studentResult.rows && studentResult.rows.length > 0) {
            const studentRow = studentResult.rows[0];
            let studentInfo;
            
            if (profileSource === 'users') {
              studentInfo = {
                name: studentRow.name || req.studentName || req.studentEmail?.split('@')[0] || 'Student',
                profilePic: studentRow.profileimage || null
              };
            } else {
              studentInfo = {
                name: studentRow.name || req.studentName || req.studentEmail?.split('@')[0] || 'Student',
                profilePic: studentRow.profilepic || 
                           studentRow.profile_pic || 
                           studentRow.profileImage || 
                           studentRow.profile_image || 
                           studentRow.profileimage || 
                           null
              };
            }
            
            return {
              ...req,
              studentName: studentInfo.name || req.studentName,
              studentInfo: studentInfo
            };
          }
        } catch (studentError) {
          console.error('❌ Error fetching student profile in fallback:', studentError);
        }
        
        return req;
      })
    );

    res.json({
      success: true,
      requests: requestsWithProfiles
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

    // Save previous status to detect actual transitions
    const previousStatus = booking.status;

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

    // Contact saving removed - contacts will be saved when student sends first message

    // If booking is accepted/subscribed, add student to subject group for broadcasting
    if (status === 'accepted' || status === 'subscribed') {
      try {
        const { addToSubjectGroup } = require('../socket');
        
        // Add student to subject group for real-time broadcasting
        addToSubjectGroup(
          booking.teacherEmail,
          booking.subject,
          booking.className || '',
          booking.studentEmail
        );

        // Fetch student profile picture from students table (with 's')
        let studentProfilePic = '';
        try {
          // Try multiple column names for profile picture
          const studentQuery = `
            SELECT profilepic, profile_pic, profileImage, profile_image, profileimage 
            FROM students 
            WHERE email = ? ALLOW FILTERING
          `;
          const studentResult = await client.execute(studentQuery, [booking.studentEmail], { prepare: true });
          
          if (studentResult.rows && studentResult.rows.length > 0) {
            const studentRow = studentResult.rows[0];
            studentProfilePic = studentRow.profilepic || 
                              studentRow.profile_pic || 
                              studentRow.profileImage || 
                              studentRow.profile_image || 
                              studentRow.profileimage || 
                              '';
          }
        } catch (profileError) {
          console.warn('⚠️ Could not fetch student profile picture:', profileError.message);
        }

        // Also add to broadcast table for tracking
        const broadcastQuery = `
          INSERT INTO broadcast_table 
          (teacherEmail, className, subject, boardOrUniversity, studentEmail, teacherName, teacherProfilePic, studentName, studentProfilePic, date_time)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        await client.execute(broadcastQuery, [
          booking.teacherEmail,
          booking.className || '',
          booking.subject,
          booking.boardOrUniversity || '',
          booking.studentEmail,
          userName,
          '', // teacher profile pic - will be fetched if needed
          booking.studentName,
          studentProfilePic, // actual student profile picture
          new Date().toISOString()
        ], { prepare: true });
        
        console.log(`📚 Added ${booking.studentEmail} to subject group: ${booking.subject}:${booking.className || 'General'}`);
        
      } catch (subscriptionError) {
        console.error('❌ Error adding student to subject group:', subscriptionError);
        // Don't fail the booking response if subscription fails
      }
    } else if (status === 'rejected') {
      // Remove from subject group if rejected
      try {
        const { removeFromSubjectGroup } = require('../socket');
        
        removeFromSubjectGroup(
          booking.teacherEmail,
          booking.subject,
          booking.className || '',
          booking.studentEmail
        );
        
        console.log(`🚫 Removed ${booking.studentEmail} from subject group: ${booking.subject}:${booking.className || 'General'}`);
        
      } catch (subscriptionError) {
        console.error('❌ Error removing student from subject group:', subscriptionError);
      }
    }

    // Notify student via WebSocket only if status actually changed
    if (previousStatus !== status) {
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
    } else {
      console.log(`⚠️ Booking ${bookingId} status unchanged (${status}), skipping socket emission`);
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

// DELETE /api/bookings/:bookingId - Cancel a booking request (student) or reject/delete (teacher)
router.delete('/:bookingId', verifyToken, async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userEmail = req.user.email;
    const userRole = req.user.role;

    const booking = bookingRequests.get(bookingId);
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking request not found'
      });
    }

    const isStudent = booking.studentEmail === userEmail;
    const isTeacher = booking.teacherEmail === userEmail;

    // Verify the user is authorized (student or teacher for this booking)
    if (!isStudent && !isTeacher) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this request'
      });
    }

    // Student can only cancel pending requests
    if (isStudent && booking.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Cannot cancel a ${booking.status} request`
      });
    }

    // Teacher can delete any pending request (this is a rejection)
    if (isTeacher && booking.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Cannot delete a ${booking.status} request`
      });
    }

    // Remove from in-memory cache
    bookingRequests.delete(bookingId);

    // Delete from Cassandra database
    try {
      const deleteQuery = `DELETE FROM booking_requests WHERE id = ?`;
      await client.execute(deleteQuery, [bookingId], { prepare: true });
      console.log('✅ Booking request deleted from Cassandra:', bookingId);
    } catch (dbError) {
      console.error('❌ Error deleting booking from Cassandra:', dbError);
      // Don't fail the request if DB delete fails, in-memory still works
    }

    // Notify the other party via WebSocket
    try {
      const io = getIO();
      if (isStudent) {
        // Notify teacher that student cancelled
        io.to(`user:${booking.teacherEmail}`).emit('booking_cancelled', {
          bookingId: bookingId,
          studentEmail: userEmail,
          message: 'Student cancelled the request'
        });
      } else {
        // Notify student that teacher rejected (deleted) the request
        io.to(`user:${booking.studentEmail}`).emit('booking_deleted', {
          bookingId: bookingId,
          teacherEmail: userEmail,
          message: 'Teacher declined the request'
        });
      }
    } catch (socketError) {
      console.error('Socket notification failed:', socketError);
    }

    res.json({
      success: true,
      message: isStudent ? 'Booking request cancelled' : 'Booking request declined'
    });
  } catch (error) {
    console.error('Error deleting booking:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete booking'
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

// GET /api/bookings/check-subscription - Check if student has active subscription to teacher
router.get('/check-subscription', verifyToken, async (req, res) => {
  try {
    const { studentEmail, teacherEmail } = req.query;
    const tokenEmail = req.user.email;

    // Use provided student email or fall back to token email
    const student = studentEmail || tokenEmail;

    if (!teacherEmail) {
      return res.status(400).json({
        success: false,
        message: 'Teacher email is required'
      });
    }

    // Verify the requesting user has permission to check this
    if (tokenEmail !== student && tokenEmail !== teacherEmail) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to check this subscription'
      });
    }

    console.log(`🔍 Checking subscription: student=${student}, teacher=${teacherEmail}`);

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
        // Find the most recent active booking
        const rows = result.rows
          .filter(row => ['subscribed', 'accepted', 'pending'].includes(row.status))
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
          };
        }
      }
    } catch (dbError) {
      console.error('Error fetching from Cassandra:', dbError);
    }

    // Fallback to in-memory storage
    if (!booking) {
      booking = Array.from(bookingRequests.values())
        .filter(b => 
          b.studentEmail === student &&
          b.teacherEmail === teacherEmail &&
          ['subscribed', 'accepted', 'pending'].includes(b.status)
        )
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
    }

    // Determine chat access based on subscription status
    let subscriptionCheck = {
      canChat: false,
      isSubscribed: false,
      status: 'none',
      message: 'No active subscription found',
    };

    if (booking) {
      switch (booking.status) {
        case 'subscribed':
          subscriptionCheck = {
            canChat: true,
            isSubscribed: true,
            status: 'subscribed',
            message: 'Active subscription found',
            subscriptionDetails: {
              subject: booking.subject,
              className: booking.className,
              charge: booking.charge,
              startDate: booking.timestamp,
            }
          };
          break;
        case 'accepted':
          subscriptionCheck = {
            canChat: true,
            isSubscribed: false,
            status: 'accepted',
            message: 'Request accepted. Complete payment to subscribe.',
            subscriptionDetails: {
              subject: booking.subject,
              className: booking.className,
              charge: booking.charge,
            }
          };
          break;
        case 'pending':
          subscriptionCheck = {
            canChat: true,
            isSubscribed: false,
            status: 'pending',
            message: 'Request pending. You can send messages once approved.',
            subscriptionDetails: {
              subject: booking.subject,
              className: booking.className,
              charge: booking.charge,
            }
          };
          break;
        case 'rejected':
          subscriptionCheck = {
            canChat: false,
            isSubscribed: false,
            status: 'rejected',
            message: 'Request was rejected. You can send a new request.',
          };
          break;
      }
    } else {
      subscriptionCheck.message = 'Subscribe to a subject to start chatting with this teacher';
    }

    console.log(`✅ Subscription check result:`, subscriptionCheck);

    res.json({
      success: true,
      ...subscriptionCheck,
    });

  } catch (error) {
    console.error('Error checking subscription:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check subscription status'
    });
  }
});

// GET /api/bookings/subscribed-teachers - Get list of teachers a student is subscribed to
router.get('/subscribed-teachers', verifyToken, async (req, res) => {
  try {
    const tokenEmail = req.user.email;
    
    console.log(`📚 Fetching subscribed teachers for student: ${tokenEmail}`);

    // Try to fetch from Cassandra first
    let subscribedTeachers = [];
    try {
      const query = `
        SELECT * FROM booking_requests
        WHERE student_email = ? AND status IN ('subscribed', 'accepted')
        ALLOW FILTERING
      `;
      const result = await client.execute(query, [tokenEmail], { prepare: true });

      if (result.rows && result.rows.length > 0) {
        // Fetch teacher details for each booking
        for (const row of result.rows) {
          let teacherName = row.teacher_name;
          let teacherProfilePic = row.teacher_info?.profilePic || null;
          
          // If teacher name is not available or is just email, fetch from teachers collection
          if (!teacherName || teacherName.includes('@')) {
            try {
              const teacherQuery = `
                SELECT name, profileimage FROM users 
                WHERE email = ? LIMIT 1
              `;
              const teacherResult = await client.execute(teacherQuery, [row.teacher_email], { prepare: true });
              
              if (teacherResult.rows && teacherResult.rows.length > 0) {
                const teacherRow = teacherResult.rows[0];
                teacherName = teacherRow.name || row.teacher_name;
                teacherProfilePic = teacherRow.profileimage || teacherProfilePic;
              }
            } catch (teacherError) {
              console.error('Error fetching teacher details:', teacherError);
              // Use fallback name
              teacherName = row.teacher_name || row.teacher_email?.split('@')[0] || 'Teacher';
            }
          }
          
          subscribedTeachers.push({
            id: row.id,
            email: row.teacher_email,
            name: teacherName,
            profilePic: teacherProfilePic,
            subject: row.subject,
            className: row.class_name,
            charge: row.charge,
            status: row.status,
            enrollmentDate: row.created_at,
            lastMessage: '',
            lastMessageTime: '',
            unreadCount: 0
          });
        }
      }
    } catch (dbError) {
      console.error('Error fetching from Cassandra:', dbError);
    }

    // Fallback to in-memory storage with teacher details fetching
    if (subscribedTeachers.length === 0) {
      const bookings = Array.from(bookingRequests.values())
        .filter(booking => 
          booking.studentEmail === tokenEmail && 
          ['subscribed', 'accepted'].includes(booking.status)
        );

      for (const booking of bookings) {
        let teacherName = booking.teacherName;
        let teacherProfilePic = booking.teacherInfo?.profilePic || null;
        
        // Try to fetch teacher details if name is not proper
        if (!teacherName || teacherName.includes('@')) {
          try {
            const teacherQuery = `
              SELECT name, profileimage FROM users 
              WHERE email = ? LIMIT 1
            `;
            const teacherResult = await client.execute(teacherQuery, [booking.teacherEmail], { prepare: true });
            
            if (teacherResult.rows && teacherResult.rows.length > 0) {
              const teacherRow = teacherResult.rows[0];
              teacherName = teacherRow.name || booking.teacherName;
              teacherProfilePic = teacherRow.profileimage || teacherProfilePic;
            }
          } catch (teacherError) {
            console.error('Error fetching teacher details:', teacherError);
            teacherName = booking.teacherName || booking.teacherEmail?.split('@')[0] || 'Teacher';
          }
        }
        
        subscribedTeachers.push({
          id: booking.id,
          email: booking.teacherEmail,
          name: teacherName,
          profilePic: teacherProfilePic,
          subject: booking.subject,
          className: booking.className,
          charge: booking.charge,
          status: booking.status,
          enrollmentDate: booking.timestamp,
          lastMessage: '',
          lastMessageTime: '',
          unreadCount: 0
        });
      }
    }

    console.log(`✅ Found ${subscribedTeachers.length} subscribed teachers`);

    res.json({
      success: true,
      teachers: subscribedTeachers
    });

  } catch (error) {
    console.error('Error fetching subscribed teachers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch subscribed teachers'
    });
  }
});

module.exports = { router, initBookingTable, bookingRequests };
