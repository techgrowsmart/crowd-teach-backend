require("dotenv").config();
const express = require('express');
const mongoose = require('mongoose');
const { Post } = require('./models/Post');

const app = express();
app.use(express.json());

// Test endpoint without authentication
app.get('/test-posts', async (req, res) => {
  try {
    await mongoose.connect(process.env.MONGO_DB_URL);
    console.log('✅ Connected to MongoDB');
    
    const posts = await Post.find({});
    console.log(`📊 Found ${posts.length} posts`);
    
    res.json({
      success: true,
      count: posts.length,
      data: posts.map(post => ({
        id: post._id,
        content: post.content,
        authorEmail: post.authorEmail,
        authorName: post.authorName,
        createdAt: post.createdAt
      }))
    });
  } catch (error) {
    console.error('❌ Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`🚀 Test server running on port ${PORT}`);
});
