const express = require('express');
const router = express.Router();
const verifyToken = require('../utils/verifyToken');
const mongoose = require('mongoose');

// Teacher Review Schema
const TeacherReviewSchema = new mongoose.Schema({
  teacherEmail: { type: String, required: true, index: true },
  studentEmail: { type: String, required: true },
  studentName: { type: String, required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  review: { type: String, required: true },
  subject: { type: String },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const TeacherReview = mongoose.model('TeacherReview', TeacherReviewSchema);

// Get reviews for a specific teacher
router.get('/teacher-reviews', async (req, res) => {
  try {
    const { teacherEmail } = req.query;
    
    if (!teacherEmail) {
      return res.status(400).json({
        success: false,
        message: 'Teacher email is required'
      });
    }
    
    const reviews = await TeacherReview.find({ teacherEmail })
      .sort({ createdAt: -1 })
      .limit(50);
    
    // Calculate average rating
    const avgRating = reviews.length > 0 
      ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
      : 0;
    
    res.json({
      success: true,
      reviews: reviews,
      averageRating: avgRating.toFixed(1),
      totalReviews: reviews.length
    });
  } catch (error) {
    console.error('Error fetching teacher reviews:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reviews'
    });
  }
});

// Get reviews for a specific teacher (alternative endpoint)
router.get('/reviews/teacher', async (req, res) => {
  try {
    const { teacherEmail } = req.query;
    
    if (!teacherEmail) {
      return res.status(400).json({
        success: false,
        message: 'Teacher email is required'
      });
    }
    
    const reviews = await TeacherReview.find({ teacherEmail })
      .sort({ createdAt: -1 })
      .limit(50);
    
    const avgRating = reviews.length > 0 
      ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
      : 0;
    
    res.json({
      success: true,
      reviews: reviews,
      averageRating: avgRating.toFixed(1),
      totalReviews: reviews.length
    });
  } catch (error) {
    console.error('Error fetching reviews:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reviews'
    });
  }
});

// Add a review for a teacher
router.post('/teacher-reviews', verifyToken, async (req, res) => {
  try {
    const { teacherEmail, rating, review, subject } = req.body;
    const studentEmail = req.user.email;
    const studentName = req.user.name || studentEmail.split('@')[0];
    
    if (!teacherEmail || !rating || !review) {
      return res.status(400).json({
        success: false,
        message: 'Teacher email, rating, and review are required'
      });
    }
    
    if (rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: 'Rating must be between 1 and 5'
      });
    }
    
    // Check if student already reviewed this teacher
    const existingReview = await TeacherReview.findOne({
      teacherEmail,
      studentEmail
    });
    
    if (existingReview) {
      // Update existing review
      existingReview.rating = rating;
      existingReview.review = review;
      existingReview.subject = subject || existingReview.subject;
      existingReview.updatedAt = new Date();
      await existingReview.save();
      
      return res.json({
        success: true,
        message: 'Review updated successfully',
        review: existingReview
      });
    }
    
    // Create new review
    const newReview = new TeacherReview({
      teacherEmail,
      studentEmail,
      studentName,
      rating,
      review,
      subject
    });
    
    await newReview.save();
    
    res.status(201).json({
      success: true,
      message: 'Review added successfully',
      review: newReview
    });
  } catch (error) {
    console.error('Error adding review:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add review'
    });
  }
});

// Get all reviews (for admin)
router.get('/reviews', verifyToken, async (req, res) => {
  try {
    const reviews = await TeacherReview.find({})
      .sort({ createdAt: -1 })
      .limit(100);
    
    res.json({
      success: true,
      reviews: reviews
    });
  } catch (error) {
    console.error('Error fetching all reviews:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reviews'
    });
  }
});

module.exports = router;
