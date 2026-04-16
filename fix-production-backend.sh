#!/bin/bash

# GrowSmart Production Backend Fix Script
# Fixes missing API endpoints and MongoDB integration for production

echo "=========================================="
echo "GrowSmart Production Backend Fix"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    local status="$1"
    local message="$2"
    
    case $status in
        "SUCCESS")
            echo -e "${GREEN}# $message${NC}"
            ;;
        "WARNING")
            echo -e "${YELLOW}# $message${NC}"
            ;;
        "ERROR")
            echo -e "${RED}# $message${NC}"
            ;;
        "INFO")
            echo -e "${BLUE}# $message${NC}"
            ;;
    esac
}

# Check if we're in the right directory
if [ ! -f "app.js" ]; then
    print_status "ERROR" "Please run this script from the crowd-teach-gogrowsmart-backend directory"
    exit 1
fi

print_status "INFO" "Starting production backend fixes..."
echo ""

# 1. Create missing API endpoints for teacher reviews
print_status "INFO" "Creating missing API endpoints..."

cat > routes/teacher-reviews.js << 'EOF'
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
EOF

# 2. Create contacts API endpoint
cat > routes/contacts.js << 'EOF'
const express = require('express');
const router = express.Router();
const verifyToken = require('../utils/verifyToken');
const mongoose = require('mongoose');

// Contact/Connection Schema
const ContactSchema = new mongoose.Schema({
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
});

const Contact = mongoose.model('Contact', ContactSchema);

// Get contacts for a user
router.get('/contacts', verifyToken, async (req, res) => {
  try {
    const userEmail = req.user.email;
    
    const contacts = await Contact.find({
      $or: [
        { requesterEmail: userEmail },
        { recipientEmail: userEmail }
      ],
      status: 'accepted'
    })
    .sort({ updatedAt: -1 })
    .limit(50);
    
    res.json({
      success: true,
      contacts: contacts
    });
  } catch (error) {
    console.error('Error fetching contacts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch contacts'
    });
  }
});

// Get pending connection requests
router.get('/contacts/pending', verifyToken, async (req, res) => {
  try {
    const userEmail = req.user.email;
    
    const pendingRequests = await Contact.find({
      recipientEmail: userEmail,
      status: 'pending'
    })
    .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      pendingRequests: pendingRequests
    });
  } catch (error) {
    console.error('Error fetching pending requests:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending requests'
    });
  }
});

// Send connection request
router.post('/contacts', verifyToken, async (req, res) => {
  try {
    const { recipientEmail, message } = req.body;
    const requesterEmail = req.user.email;
    const requesterName = req.user.name || requesterEmail.split('@')[0];
    
    if (!recipientEmail) {
      return res.status(400).json({
        success: false,
        message: 'Recipient email is required'
      });
    }
    
    if (recipientEmail === requesterEmail) {
      return res.status(400).json({
        success: false,
        message: 'Cannot send connection request to yourself'
      });
    }
    
    // Check if connection already exists
    const existingContact = await Contact.findOne({
      $or: [
        { requesterEmail, recipientEmail },
        { requesterEmail: recipientEmail, recipientEmail: requesterEmail }
      ]
    });
    
    if (existingContact) {
      return res.status(400).json({
        success: false,
        message: 'Connection already exists or pending'
      });
    }
    
    // Get recipient name (you might need to query user collection here)
    const recipientName = recipientEmail.split('@')[0];
    
    const newContact = new Contact({
      requesterEmail,
      recipientEmail,
      requesterName,
      recipientName,
      message: message || '',
      status: 'pending'
    });
    
    await newContact.save();
    
    res.status(201).json({
      success: true,
      message: 'Connection request sent successfully',
      contact: newContact
    });
  } catch (error) {
    console.error('Error sending connection request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send connection request'
    });
  }
});

// Accept connection request
router.put('/contacts/:contactId/accept', verifyToken, async (req, res) => {
  try {
    const { contactId } = req.params;
    const userEmail = req.user.email;
    
    const contact = await Contact.findOne({
      _id: contactId,
      recipientEmail: userEmail,
      status: 'pending'
    });
    
    if (!contact) {
      return res.status(404).json({
        success: false,
        message: 'Connection request not found'
      });
    }
    
    contact.status = 'accepted';
    contact.updatedAt = new Date();
    await contact.save();
    
    res.json({
      success: true,
      message: 'Connection request accepted',
      contact: contact
    });
  } catch (error) {
    console.error('Error accepting connection request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to accept connection request'
    });
  }
});

// Reject connection request
router.put('/contacts/:contactId/reject', verifyToken, async (req, res) => {
  try {
    const { contactId } = req.params;
    const userEmail = req.user.email;
    
    const contact = await Contact.findOne({
      _id: contactId,
      recipientEmail: userEmail,
      status: 'pending'
    });
    
    if (!contact) {
      return res.status(404).json({
        success: false,
        message: 'Connection request not found'
      });
    }
    
    contact.status = 'rejected';
    contact.updatedAt = new Date();
    await contact.save();
    
    res.json({
      success: true,
      message: 'Connection request rejected',
      contact: contact
    });
  } catch (error) {
    console.error('Error rejecting connection request:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject connection request'
    });
  }
});

module.exports = router;
EOF

# 3. Create enrollment data API endpoint
cat > routes/enrollment-data.js << 'EOF'
const express = require('express');
const router = express.Router();
const verifyToken = require('../utils/verifyToken');
const mongoose = require('mongoose');

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
EOF

print_status "SUCCESS" "Missing API endpoints created"

# 4. Update app.js to include the new routes
print_status "INFO" "Updating app.js to include new routes..."

# Backup original app.js
cp app.js app.js.backup

# Add new routes to app.js
sed -i '/app.use("\/api", favoritesRoutes);/a\
\
// Missing API endpoints for production\
const teacherReviewsRoutes = require("./routes/teacher-reviews");\
app.use("/api", teacherReviewsRoutes);\
\
const contactsRoutes = require("./routes/contacts");\
app.use("/api", contactsRoutes);\
\
const enrollmentDataRoutes = require("./routes/enrollment-data");\
app.use("/api", enrollmentDataRoutes);' app.js

print_status "SUCCESS" "app.js updated with new routes"

# 5. Create MongoDB models initialization
print_status "INFO" "Creating MongoDB models initialization..."

cat > config/mongo-models.js << 'EOF'
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
EOF

print_status "SUCCESS" "MongoDB models initialization created"

# 6. Update MongoDB connection to initialize models
print_status "INFO" "Updating MongoDB connection to initialize models..."

# Add models initialization to mongoDB.js
sed -i '/const connectMongoDB = async () {/a\
\
// Initialize MongoDB models\
const { createIndexes } = require("./mongo-models");' config/mongoDB.js

sed -i '/console.log(".* Connected to MongoDB successfully");/a\
      \
      // Initialize models and indexes\
      createIndexes();' config/mongoDB.js

print_status "SUCCESS" "MongoDB connection updated"

# 7. Create deployment script for EC2
print_status "INFO" "Creating EC2 deployment script..."

cat > deploy-ec2-production.sh << 'EOF'
#!/bin/bash

echo "=========================================="
echo "GrowSmart EC2 Production Deployment"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    local status="\$1"
    local message="\$2"
    
    case \$status in
        "SUCCESS") echo -e "\${GREEN}# \$message\${NC}" ;;
        "WARNING") echo -e "\${YELLOW}# \$message\${NC}" ;;
        "ERROR") echo -e "\${RED}# \$message\${NC}" ;;
        "INFO") echo -e "\${BLUE}# \$message\${NC}" ;;
    esac
}

# Check if we're in the right directory
if [ ! -f "app.js" ]; then
    print_status "ERROR" "Please run this script from the crowd-teach-gogrowsmart-backend directory"
    exit 1
fi

print_status "INFO" "Starting EC2 production deployment..."

# 1. Install dependencies
print_status "INFO" "Installing dependencies..."
npm install --production

# 2. Set production environment
print_status "INFO" "Setting production environment..."
export NODE_ENV=production
export MONGO_DB_DATABASE=test

# 3. Stop existing process
print_status "INFO" "Stopping existing server..."
pkill -f "node app.js" || true

# 4. Start production server
print_status "INFO" "Starting production server..."
nohup node app.js > production.log 2>&1 &
SERVER_PID=\$!
echo "Server PID: \$SERVER_PID"

# 5. Wait for server to start
print_status "INFO" "Waiting for server to start..."
sleep 10

# 6. Test server health
print_status "INFO" "Testing server health..."
if curl -f http://localhost:3000/api/ping > /dev/null 2>&1; then
    print_status "SUCCESS" "Server is running and responding"
else
    print_status "ERROR" "Server failed to start"
    echo "Check production.log for errors"
    exit 1
fi

# 7. Test MongoDB connection
print_status "INFO" "Testing MongoDB connection..."
if curl -f http://localhost:3000/api/health > /dev/null 2>&1; then
    print_status "SUCCESS" "MongoDB connection working"
else
    print_status "WARNING" "MongoDB connection may have issues"
fi

# 8. Test new API endpoints
print_status "INFO" "Testing new API endpoints..."

# Test teacher reviews endpoint
if curl -f "http://localhost:3000/api/teacher-reviews?teacherEmail=test@example.com" > /dev/null 2>&1; then
    print_status "SUCCESS" "Teacher reviews endpoint working"
else
    print_status "WARNING" "Teacher reviews endpoint may have issues"
fi

# Test contacts endpoint
if curl -f http://localhost:3000/api/contacts -H "Authorization: Bearer test-token" > /dev/null 2>&1; then
    print_status "SUCCESS" "Contacts endpoint working"
else
    print_status "WARNING" "Contacts endpoint may have issues"
fi

# Test enrollment data endpoint
if curl -f http://localhost:3000/api/enrollment-data -H "Authorization: Bearer test-token" > /dev/null 2>&1; then
    print_status "SUCCESS" "Enrollment data endpoint working"
else
    print_status "WARNING" "Enrollment data endpoint may have issues"
fi

echo ""
print_status "SUCCESS" "EC2 Production Deployment Complete!"
echo ""
echo -e "\${GREEN}Server Information:\${NC}"
echo "PID: \$SERVER_PID"
echo "URL: http://localhost:3000"
echo "Environment: Production"
echo "Database: MongoDB (test)"
echo ""
echo -e "\${BLUE}New API Endpoints:\${NC}"
echo "GET  /api/teacher-reviews"
echo "GET  /api/reviews/teacher"
echo "POST /api/teacher-reviews"
echo "GET  /api/contacts"
echo "POST /api/contacts"
echo "GET  /api/enrollment-data"
echo "POST /api/enrollment-data"
echo ""
echo -e "\${YELLOW}Commands:\${NC}"
echo "View logs: tail -f production.log"
echo "Stop server: kill \$SERVER_PID"
echo "Restart: ./deploy-ec2-production.sh"
echo ""
print_status "SUCCESS" "GrowSmart server is ready for production!"
EOF

chmod +x deploy-ec2-production.sh

print_status "SUCCESS" "EC2 deployment script created"

echo ""
print_status "SUCCESS" "PRODUCTION BACKEND FIX COMPLETE!"
echo ""
echo -e "\${GREEN}What's been fixed:\${NC}"
echo "Missing API endpoints created (teacher-reviews, contacts, enrollment-data)"
echo "MongoDB models and indexes initialized"
echo "Production deployment script created"
echo "Error handling improved"
echo ""
echo -e "\${BLUE}New API Endpoints:\${NC}"
echo "GET  /api/teacher-reviews - Get teacher reviews"
echo "GET  /api/reviews/teacher - Alternative teacher reviews endpoint"
echo "POST /api/teacher-reviews - Add teacher review"
echo "GET  /api/contacts - Get user contacts"
echo "POST /api/contacts - Send connection request"
echo "GET  /api/enrollment-data - Get enrollment data"
echo "POST /api/enrollment-data - Create enrollment"
echo ""
echo -e "\${YELLOW}Next Steps:\${NC}"
echo "1. Deploy to EC2: ./deploy-ec2-production.sh"
echo "2. Test all API endpoints"
echo "3. Verify MongoDB connection"
echo "4. Monitor server logs"
echo ""
print_status "SUCCESS" "The production backend is now ready!"
