const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// Landing Page Review Schema
const LandingReviewSchema = new mongoose.Schema({
  userId: { type: String, required: true, index: true },
  userName: { type: String, required: true },
  userEmail: { type: String },
  userAvatar: { type: String },
  rating: { type: Number, required: true, min: 1, max: 5 },
  title: { type: String, required: true },
  content: { type: String, required: true },
  status: { type: String, default: 'approved', enum: ['pending', 'approved', 'rejected'] },
  metadata: {
    userAgent: { type: String },
    ipAddress: { type: String },
    platform: { type: String }
  },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

const LandingReview = mongoose.model('LandingReview', LandingReviewSchema);

// GET /api/landing-reviews - Fetch reviews with pagination and filtering
router.get('/landing-reviews', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const sortBy = req.query.sortBy || 'createdAt';

    // Validate pagination parameters
    if (page < 1 || limit < 1 || limit > 50) {
      return res.status(400).json({
        success: false,
        message: 'Invalid pagination parameters'
      });
    }

    // Build sort
    const sort = {};
    if (sortBy === 'createdAt') {
      sort.createdAt = -1;
    } else if (sortBy === 'rating') {
      sort.rating = -1;
      sort.createdAt = -1;
    }

    // Get total count
    const total = await LandingReview.countDocuments({ status: 'approved' });

    // Get paginated results
    const skip = (page - 1) * limit;
    const reviews = await LandingReview.find({ status: 'approved' })
      .sort(sort)
      .skip(skip)
      .limit(limit);

    res.json({
      success: true,
      reviews: reviews,
      total: total,
      page: page,
      limit: limit
    });
  } catch (error) {
    console.error('Error fetching landing reviews:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch reviews'
    });
  }
});

// POST /api/landing-reviews - Create a new review
router.post('/landing-reviews', async (req, res) => {
  try {
    const { userId, userName, userEmail, userAvatar, rating, title, content, platform } = req.body;

    // Validate required fields
    if (!userId || !userName || !rating || !title || !content) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: userId, userName, rating, title, content'
      });
    }

    // Validate rating
    if (rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: 'Rating must be between 1 and 5'
      });
    }

    // Validate content length
    if (title.length < 3 || title.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Title must be between 3 and 100 characters'
      });
    }

    if (content.length < 10 || content.length > 2000) {
      return res.status(400).json({
        success: false,
        message: 'Content must be between 10 and 2000 characters'
      });
    }

    console.log('Starting review creation...');

    // Create review
    const review = new LandingReview({
      userId,
      userName,
      userEmail,
      userAvatar,
      rating,
      title,
      content,
      metadata: {
        userAgent: req.headers['user-agent'],
        platform: platform
      }
    });

    await review.save();
    console.log('Review created successfully:', review._id);

    res.status(201).json({
      success: true,
      review: review
    });
  } catch (error) {
    console.error('Error creating review:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create review'
    });
  }
});

// GET /api/landing-reviews/stats - Get review statistics
router.get('/landing-reviews/stats', async (req, res) => {
  try {
    const reviews = await LandingReview.find({ status: 'approved' });

    if (reviews.length === 0) {
      return res.json({
        success: true,
        totalReviews: 0,
        averageRating: 0,
        ratingDistribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }
      });
    }

    const totalReviews = reviews.length;
    const averageRating = Math.round(
      (reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews) * 10
    ) / 10;

    const ratingDistribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };

    reviews.forEach(review => {
      ratingDistribution[review.rating]++;
    });

    res.json({
      success: true,
      totalReviews,
      averageRating,
      ratingDistribution
    });
  } catch (error) {
    console.error('Error in getStats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch stats'
    });
  }
});

module.exports = router;