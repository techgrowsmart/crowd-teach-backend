const express = require('express');
const router = express.Router();
const verifyToken = require('../utils/verifyToken');
const client = require('../config/db');

// GET /api/teacher/enrolled-students - Get all students enrolled with this teacher
router.get('/enrolled-students', verifyToken, async (req, res) => {
  try {
    const teacherEmail = req.user.email;
    
    if (!teacherEmail) {
      return res.status(400).json({
        success: false,
        message: 'Teacher email not found in token'
      });
    }

    console.log(`📚 Fetching enrolled students for teacher: ${teacherEmail}`);

    // Query to get students who have bookings/connections with this teacher
    // This queries the teacher_students table or bookings table
    let students = [];
    
    try {
      // First try: Query from teacher_students table if it exists
      const teacherStudentsQuery = `
        SELECT student_email, student_name, enrolled_date, status 
        FROM teacher_students 
        WHERE teacher_email = ? 
        ALLOW FILTERING
      `;
      
      const result = await client.execute(teacherStudentsQuery, [teacherEmail], { prepare: true });
      
      if (result.rows && result.rows.length > 0) {
        students = result.rows.map(row => ({
          id: row.student_email,
          email: row.student_email,
          name: row.student_name || row.student_email?.split('@')[0] || 'Unknown Student',
          enrolled_date: row.enrolled_date || new Date().toISOString(),
          status: row.status || 'active'
        }));
      }
    } catch (dbError) {
      console.log('teacher_students table not available, trying alternative...');
    }

    // Second try: Get from bookings/addon classes
    if (students.length === 0) {
      try {
        const bookingsQuery = `
          SELECT studentemail, studentname, created_at
          FROM addon_class_bookings 
          WHERE teacheremail = ? 
          ALLOW FILTERING
        `;
        
        const bookingsResult = await client.execute(bookingsQuery, [teacherEmail], { prepare: true });
        
        if (bookingsResult.rows && bookingsResult.rows.length > 0) {
          // Get unique students from bookings
          const uniqueStudents = new Map();
          
          bookingsResult.rows.forEach(row => {
            const email = row.studentemail;
            if (!uniqueStudents.has(email)) {
              uniqueStudents.set(email, {
                id: email,
                email: email,
                name: row.studentname || email?.split('@')[0] || 'Unknown Student',
                enrolled_date: row.created_at || new Date().toISOString(),
                status: 'active'
              });
            }
          });
          
          students = Array.from(uniqueStudents.values());
        }
      } catch (bookingError) {
        console.log('Bookings table query failed:', bookingError.message);
      }
    }

    // Third try: Get from connection requests
    if (students.length === 0) {
      try {
        // Query MongoDB for accepted connections
        const mongoose = require('mongoose');
        
        // Check if mongoose connection is ready
        if (mongoose.connection.readyState === 1) {
          const Contact = mongoose.model('Contact');
          
          const connections = await Contact.find({
            $or: [
              { requesterEmail: teacherEmail, status: 'accepted' },
              { recipientEmail: teacherEmail, status: 'accepted' }
            ]
          }).sort({ updatedAt: -1 });
          
          students = connections.map(conn => {
            const isRequester = conn.requesterEmail === teacherEmail;
            const studentEmail = isRequester ? conn.recipientEmail : conn.requesterEmail;
            const studentName = isRequester ? conn.recipientName : conn.requesterName;
            
            return {
              id: conn._id?.toString() || studentEmail,
              email: studentEmail,
              name: studentName || studentEmail?.split('@')[0] || 'Unknown Student',
              enrolled_date: conn.updatedAt || conn.createdAt || new Date().toISOString(),
              status: 'active'
            };
          });
        }
      } catch (connError) {
        console.log('MongoDB connection query failed:', connError.message);
      }
    }

    // If still no students, return empty array (frontend will handle empty state)
    console.log(`✅ Found ${students.length} enrolled students`);

    res.json({
      success: true,
      data: students,
      count: students.length
    });
    
  } catch (error) {
    console.error('❌ Error fetching enrolled students:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch enrolled students',
      error: error.message
    });
  }
});

module.exports = router;
