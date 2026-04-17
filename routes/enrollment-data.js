const express = require('express');
const router = express.Router();
const cors = require('cors');
const verifyToken = require('../utils/verifyToken');
const mongoose = require('mongoose');

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

// Enrollment Schema
const EnrollmentSchema = new mongoose.Schema({
  studentEmail: { type: String, required: true, index: true },
  teacherEmail: { type: String, required: true, index: true },
  subject: { type: String, required: true },
  grade: { type: String },
  status: { 
    type: String, 
    enum: ['active', 'completed', 'cancelled'], 
    default: 'active',
    index: true
  },
  startDate: { type: Date, default: Date.now },
  endDate: { type: Date },
  paymentStatus: { 
    type: String, 
    enum: ['pending', 'paid', 'refunded'], 
    default: 'pending'
  },
  amount: { type: Number },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const Enrollment = mongoose.model('Enrollment', EnrollmentSchema);

// Get enrollment data for a student
router.get('/enrollment-data', verifyToken, async (req, res) => {
  try {
    const userEmail = req.user.email;
    
    const enrollments = await Enrollment.find({ studentEmail: userEmail })
      .sort({ createdAt: -1 })
      .limit(50);
    
    // Calculate statistics
    const activeEnrollments = enrollments.filter(e => e.status === 'active').length;
    const completedEnrollments = enrollments.filter(e => e.status === 'completed').length;
    const totalAmount = enrollments.reduce((sum, e) => sum + (e.amount || 0), 0);
    
    res.json({
      success: true,
      enrollments: enrollments,
      statistics: {
        activeEnrollments,
        completedEnrollments,
        totalAmount,
        totalEnrollments: enrollments.length
      }
    });
  } catch (error) {
    console.error('Error fetching enrollment data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch enrollment data'
    });
  }
});

// Get enrollment data for a teacher
router.get('/enrollment-data/teacher', verifyToken, async (req, res) => {
  try {
    const userEmail = req.user.email;
    
    const enrollments = await Enrollment.find({ teacherEmail: userEmail })
      .sort({ createdAt: -1 })
      .limit(100);
    
    // Calculate statistics
    const activeEnrollments = enrollments.filter(e => e.status === 'active').length;
    const completedEnrollments = enrollments.filter(e => e.status === 'completed').length;
    const totalRevenue = enrollments
      .filter(e => e.paymentStatus === 'paid')
      .reduce((sum, e) => sum + (e.amount || 0), 0);
    
    res.json({
      success: true,
      enrollments: enrollments,
      statistics: {
        activeEnrollments,
        completedEnrollments,
        totalRevenue,
        totalEnrollments: enrollments.length
      }
    });
  } catch (error) {
    console.error('Error fetching teacher enrollment data:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch enrollment data'
    });
  }
});

// Create new enrollment
router.post('/enrollment-data', verifyToken, async (req, res) => {
  try {
    const { teacherEmail, subject, grade, endDate, amount } = req.body;
    const studentEmail = req.user.email;
    
    if (!teacherEmail || !subject) {
      return res.status(400).json({
        success: false,
        message: 'Teacher email and subject are required'
      });
    }
    
    // Check if enrollment already exists
    const existingEnrollment = await Enrollment.findOne({
      studentEmail,
      teacherEmail,
      subject,
      status: 'active'
    });
    
    if (existingEnrollment) {
      return res.status(400).json({
        success: false,
        message: 'Already enrolled in this subject with this teacher'
      });
    }
    
    const newEnrollment = new Enrollment({
      studentEmail,
      teacherEmail,
      subject,
      grade,
      endDate,
      amount,
      status: 'active'
    });
    
    await newEnrollment.save();
    
    res.status(201).json({
      success: true,
      message: 'Enrollment created successfully',
      enrollment: newEnrollment
    });
  } catch (error) {
    console.error('Error creating enrollment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create enrollment'
    });
  }
});

module.exports = router;
