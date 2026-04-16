#!/bin/bash

echo "=========================================="
echo "GrowSmart MongoDB Test Data Setup"
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

print_status "INFO" "Creating MongoDB test data setup script..."

# Create Node.js script to add test data
cat > add-mongo-test-data.js << 'EOF'
const mongoose = require('mongoose');
require('dotenv').config();

// MongoDB connection
const connectMongoDB = async () => {
  try {
    const mongoURI = process.env.MONGO_DB_URL;
    const dbName = process.env.MONGO_DB_DATABASE || 'test';
    
    console.log('🔍 Connecting to MongoDB...');
    console.log('📂 Database:', dbName);
    
    // Ensure database name is in URI
    let finalURI = mongoURI;
    if (mongoURI.includes('mongodb.net')) {
      const dbNameMatch = mongoURI.match(/\.mongodb\.net\/([^?]+)\?/);
      if (dbNameMatch) {
        const existingDbName = dbNameMatch[1];
        if (existingDbName !== dbName) {
          finalURI = mongoURI.replace(`/${existingDbName}?`, `/${dbName}?`);
          console.log(`🔄 Replaced database '${existingDbName}' with '${dbName}'`);
        }
      } else if (mongoURI.includes('/?')) {
        finalURI = mongoURI.replace('/?', `/${dbName}?`);
      } else if (!mongoURI.match(/\/[^/]+\?/)) {
        finalURI = mongoURI.replace('?', `/${dbName}?`);
      }
    }
    
    await mongoose.connect(finalURI);
    console.log('✅ Connected to MongoDB successfully');
    console.log('📊 Database:', mongoose.connection.name);
    
    return mongoose.connection;
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    throw error;
  }
};

// Post Schema
const PostSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  author_email: { type: String, required: true },
  author_name: { type: String, required: true },
  author_role: { type: String, required: true, enum: ['teacher', 'student'] },
  author_profile_pic: { type: String, default: '' },
  content: { type: String, required: true, maxlength: 2000 },
  post_image: { type: String, default: '' },
  likes: { type: Number, default: 0, min: 0 },
  tags: [{ type: String, trim: true }],
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
}, { 
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }, 
  collection: 'posts' 
});

const Post = mongoose.model('Post', PostSchema);

// Test data
const testPosts = [
  {
    id: 'thought-001',
    author_email: 'teacher@example.com',
    author_name: 'Demo Teacher',
    author_role: 'teacher',
    author_profile_pic: '',
    content: 'Mathematics is not about numbers, equations, computations, or algorithms: it is about understanding. Mathematics is the language that helps us understand the world around us, from the patterns in nature to the technology we use every day.',
    post_image: '',
    likes: 15,
    tags: ['mathematics', 'education', 'learning'],
    created_at: new Date('2024-01-15T10:00:00Z'),
    updated_at: new Date('2024-01-15T10:00:00Z')
  },
  {
    id: 'thought-002',
    author_email: 'test31@example.com',
    author_name: 'Test User',
    author_role: 'student',
    author_profile_pic: '',
    content: 'Learning physics helps us understand the fundamental laws that govern our universe. From the smallest particles to the largest galaxies, physics reveals the beauty and complexity of nature.',
    post_image: '',
    likes: 8,
    tags: ['physics', 'science', 'universe'],
    created_at: new Date('2024-01-14T15:30:00Z'),
    updated_at: new Date('2024-01-14T15:30:00Z')
  },
  {
    id: 'thought-003',
    author_email: 'teacher31@example.com',
    author_name: 'Teacher One',
    author_role: 'teacher',
    author_profile_pic: '',
    content: 'Education is the most powerful weapon which you can use to change the world. It empowers individuals, transforms societies, and builds a better future for everyone.',
    post_image: '',
    likes: 25,
    tags: ['education', 'inspiration', 'future'],
    created_at: new Date('2024-01-13T09:15:00Z'),
    updated_at: new Date('2024-01-13T09:15:00Z')
  },
  {
    id: 'thought-004',
    author_email: 'teacher@example.com',
    author_name: 'Demo Teacher',
    author_role: 'teacher',
    author_profile_pic: '',
    content: 'Chemistry is the bridge between physics and biology. It helps us understand the molecular interactions that make life possible and the chemical processes that shape our world.',
    post_image: '',
    likes: 12,
    tags: ['chemistry', 'science', 'molecules'],
    created_at: new Date('2024-01-12T14:20:00Z'),
    updated_at: new Date('2024-01-12T14:20:00Z')
  },
  {
    id: 'thought-005',
    author_email: 'test31@example.com',
    author_name: 'Test User',
    author_role: 'student',
    author_profile_pic: '',
    content: 'Programming teaches us problem-solving skills that are valuable in every field of life. It is not just about writing code, but about thinking logically and creatively.',
    post_image: '',
    likes: 18,
    tags: ['programming', 'coding', 'problem-solving'],
    created_at: new Date('2024-01-11T11:45:00Z'),
    updated_at: new Date('2024-01-11T11:45:00Z')
  }
];

// Main function
async function addTestData() {
  try {
    await connectMongoDB();
    
    console.log('📝 Adding test posts to MongoDB...');
    
    // Clear existing posts
    await Post.deleteMany({});
    console.log('🗑️ Cleared existing posts');
    
    // Add test posts
    for (const postData of testPosts) {
      const post = new Post(postData);
      await post.save();
      console.log(`✅ Added post: ${postData.id} by ${postData.author_name}`);
    }
    
    console.log(`🎉 Successfully added ${testPosts.length} test posts to MongoDB!`);
    console.log('');
    console.log('📋 Test Posts Summary:');
    testPosts.forEach(post => {
      console.log(`  📄 ${post.id}: "${post.content.substring(0, 50)}..." by ${post.author_name} (${post.likes} likes)`);
    });
    
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
    
  } catch (error) {
    console.error('❌ Error adding test data:', error);
    process.exit(1);
  }
}

// Run the function
addTestData();
EOF

print_status "SUCCESS" "MongoDB test data script created!"

# Run the script
print_status "INFO" "Adding test data to MongoDB..."
node add-mongo-test-data.js

if [ $? -eq 0 ]; then
    print_status "SUCCESS" "Test data added successfully!"
    echo ""
    print_status "INFO" "Test posts added to MongoDB 'test' database:"
    echo "  📄 thought-001: Mathematics understanding by Demo Teacher"
    echo "  📄 thought-002: Physics universe by Test User"
    echo "  📄 thought-003: Education power by Admin User"
    echo "  📄 thought-004: Chemistry bridge by Demo Teacher"
    echo "  📄 thought-005: Programming skills by Test User"
    echo ""
    print_status "INFO" "The thoughtsCard can now receive data from MongoDB!"
    echo ""
    print_status "INFO" "Test the /api/posts endpoint:"
    echo "  curl http://localhost:3000/api/posts"
    echo ""
else
    print_status "ERROR" "Failed to add test data"
    echo "Check the error messages above"
fi

# Clean up
rm -f add-mongo-test-data.js

print_status "SUCCESS" "MongoDB test data setup complete!"
