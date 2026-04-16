const mongoose = require('mongoose');

// Teacher Bank Details Schema
const teacherBankDetailsSchema = new mongoose.Schema({
  teacher_email: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  account_number: {
    type: String,
    required: true,
    trim: true
  },
  bank_name: {
    type: String,
    required: true,
    trim: true
  },
  ifsc_code: {
    type: String,
    required: true,
    trim: true,
    uppercase: true
  },
  account_holder_name: {
    type: String,
    required: true,
    trim: true
  },
  pan: {
    type: String,
    required: true,
    trim: true,
    uppercase: true
  },
  pincode: {
    type: String,
    required: true,
    trim: true
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
    index: true
  },
  submitted_at: {
    type: Date,
    default: Date.now
  },
  updated_at: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: { createdAt: 'submitted_at', updatedAt: 'updated_at' },
  collection: 'teacher_bank_details'
});

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
  account_number: {
    type: String,
    required: true,
    trim: true
  },
  bank_name: {
    type: String,
    required: true,
    trim: true
  },
  ifsc_code: {
    type: String,
    required: true,
    trim: true,
    uppercase: true
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
teacherBankDetailsSchema.index({ teacher_email: 1 }, { unique: true });
teacherOnboardingSchema.index({ email: 1 }, { unique: true });
teacherOnboardingSchema.index({ onboarding_status: 1 });

// Create models
const TeacherBankDetails = mongoose.model('TeacherBankDetails', teacherBankDetailsSchema);
const TeacherOnboarding = mongoose.model('TeacherOnboarding', teacherOnboardingSchema);

module.exports = {
  TeacherBankDetails,
  TeacherOnboarding
};
