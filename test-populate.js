require("dotenv").config();
const mongoose = require('mongoose');
const { Post } = require('./models/Post');

async function populateTestData() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_DB_URL);
    console.log('✅ Connected to MongoDB');

    // Clear existing posts
    await Post.deleteMany({});
    console.log('🗑️ Cleared existing posts');

    // Create sample posts
    const samplePosts = [
      {
        content: "Welcome to our learning community! 🎓",
        authorEmail: "teacher1@example.com",
        authorName: "Sarah Johnson",
        authorRole: "teacher",
        authorProfileImage: "",
        likes: [],
        comments: [],
        createdAt: new Date()
      },
      {
        content: "Just finished an amazing science experiment with my students! 🔬",
        authorEmail: "teacher2@example.com", 
        authorName: "Michael Chen",
        authorRole: "teacher",
        authorProfileImage: "",
        likes: [],
        comments: [],
        createdAt: new Date(Date.now() - 3600000) // 1 hour ago
      },
      {
        content: "Looking for creative teaching ideas for mathematics...",
        authorEmail: "teacher3@example.com",
        authorName: "Emily Davis", 
        authorRole: "teacher",
        authorProfileImage: "",
        likes: [],
        comments: [],
        createdAt: new Date(Date.now() - 7200000) // 2 hours ago
      }
    ];

    // Insert sample posts
    const insertedPosts = await Post.insertMany(samplePosts);
    console.log(`✅ Created ${insertedPosts.length} sample posts:`);
    insertedPosts.forEach((post, index) => {
      console.log(`  ${index + 1}. ${post.content.substring(0, 50)}...`);
    });

    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

populateTestData();
