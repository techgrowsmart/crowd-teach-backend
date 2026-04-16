const mongoose = require('mongoose');

// Define all MongoDB schemas
const schemas = {
  TeacherReview: new mongoose.Schema({
    teacherEmail: { type: String, required: true, index: true },
    studentEmail: { type: String, required: true },
    studentName: { type: String, required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    review: { type: String, required: true },
    subject: { type: String },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  }),
  
  Contact: new mongoose.Schema({
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
  }),
  
  Enrollment: new mongoose.Schema({
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
  })
};

// Initialize models
const models = {};
for (const [name, schema] of Object.entries(schemas)) {
  models[name] = mongoose.model(name, schema);
}

// Create indexes for better performance
const createIndexes = async () => {
  try {
    console.log('Creating MongoDB indexes...');
    
    // TeacherReview indexes
    await models.TeacherReview.createIndexes([
      { teacherEmail: 1 },
      { studentEmail: 1 },
      { createdAt: -1 }
    ]);
    
    // Contact indexes
    await models.Contact.createIndexes([
      { requesterEmail: 1 },
      { recipientEmail: 1 },
      { status: 1 },
      { createdAt: -1 }
    ]);
    
    // Enrollment indexes
    await models.Enrollment.createIndexes([
      { studentEmail: 1 },
      { teacherEmail: 1 },
      { status: 1 },
      { createdAt: -1 }
    ]);
    
    console.log('MongoDB indexes created successfully');
  } catch (error) {
    console.error('Error creating MongoDB indexes:', error);
  }
};

module.exports = {
  models,
  createIndexes
};
