const mongoose = require('mongoose');

// Teacher Onboarding Schema
const teacherOnboardingSchema = new mongoose.Schema({
  teacher_id: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  onboarding_status: {
    type: String,
    enum: ['pending', 'in_review', 'approved', 'rejected'],
    default: 'pending',
    index: true
  },
  onboarding_date: {
    type: Date,
    default: Date.now
  },
  reviewed_at: {
    type: Date
  },
  reviewer_notes: {
    type: String,
    default: ''
  }
}, {
  timestamps: { createdAt: 'onboarding_date', updatedAt: 'reviewed_at' },
  collection: 'teacher_onboarding'
});

// Create compound indexes for better performance
teacherOnboardingSchema.index({ email: 1 }, { unique: true });
teacherOnboardingSchema.index({ onboarding_status: 1 });

// Create models
const TeacherOnboarding = mongoose.model('TeacherOnboarding', teacherOnboardingSchema);

module.exports = {
  TeacherOnboarding
};
