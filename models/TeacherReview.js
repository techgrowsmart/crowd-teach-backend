const mongoose = require('mongoose');

// Teacher Review Schema – shared by /api/teacher-reviews and the teacher search.
const TeacherReviewSchema = new mongoose.Schema({
  teacherEmail: { type: String, required: true, index: true },
  studentEmail: { type: String, required: true },
  studentName: { type: String, required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  review: { type: String, required: true },
  subject: { type: String, index: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Reuse the compiled model when it already exists (multiple routes require this file).
const TeacherReview = mongoose.models.TeacherReview || mongoose.model('TeacherReview', TeacherReviewSchema);

module.exports = TeacherReview;
