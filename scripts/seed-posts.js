#!/usr/bin/env node
/**
 * Seed script to add sample posts to MongoDB (gogrowsmart database)
 * Run: node scripts/seed-posts.js
 * Requires: MONGO_DB_URL in .env
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const postSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true },
  author_email: { type: String, required: true },
  author_name: { type: String, required: true },
  author_role: { type: String, required: true },
  author_profile_pic: { type: String, default: '' },
  content: { type: String, required: true },
  post_image: { type: String, default: '' },
  likes: { type: Number, default: 0 },
  tags: [String],
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
}, { collection: 'posts' });

const Post = mongoose.model('Post', postSchema);

const samplePosts = [
  {
    id: uuidv4(),
    author_email: 'teacher56@example.com',
    author_name: 'Teacher',
    author_role: 'teacher',
    author_profile_pic: '',
    content: 'Welcome to GrowThoughts! Share your teaching insights and connect with fellow educators. 📚',
    post_image: '',
    likes: 0,
    tags: ['teaching', 'education'],
    created_at: new Date(),
    updated_at: new Date()
  },
  {
    id: uuidv4(),
    author_email: 'teacher56@example.com',
    author_name: 'Teacher',
    author_role: 'teacher',
    author_profile_pic: '',
    content: 'Tip of the day: Break complex topics into smaller chunks. Students learn better when information is digestible! 💡',
    post_image: '',
    likes: 0,
    tags: ['tips', 'learning'],
    created_at: new Date(Date.now() - 3600000),
    updated_at: new Date(Date.now() - 3600000)
  },
  {
    id: uuidv4(),
    author_email: 'teacher56@example.com',
    author_name: 'Teacher',
    author_role: 'teacher',
    author_profile_pic: '',
    content: 'Excited to see students engaging more in live sessions. Keep up the great work everyone! 🌟',
    post_image: '',
    likes: 0,
    tags: ['engagement'],
    created_at: new Date(Date.now() - 7200000),
    updated_at: new Date(Date.now() - 7200000)
  }
];

async function seed() {
  const mongoURI = process.env.MONGO_DB_URL;
  const dbName = process.env.MONGO_DB_DATABASE || 'gogrowsmart';

  if (!mongoURI) {
    console.error('❌ MONGO_DB_URL not found in .env');
    process.exit(1);
  }

  try {
    console.log('🔄 Connecting to MongoDB...');
    await mongoose.connect(mongoURI, { dbName });
    console.log('✅ Connected to', dbName);

    const existing = await Post.countDocuments();
    if (existing > 0) {
      console.log(`📊 Found ${existing} existing posts. Adding sample posts anyway...`);
    }

    for (const post of samplePosts) {
      const exists = await Post.findOne({ id: post.id });
      if (!exists) {
        await Post.create(post);
        console.log('✅ Added post:', post.content.substring(0, 50) + '...');
      }
    }

    const total = await Post.countDocuments();
    console.log(`\n✅ Done! Total posts in database: ${total}`);
  } catch (err) {
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected');
  }
}

seed();
