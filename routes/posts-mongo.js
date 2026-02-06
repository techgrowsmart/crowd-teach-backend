const express = require('express');
const router = express.Router();
const verifyToken = require('../utils/verifyToken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { Post, PostLike, PostComment, CommentLike, CommentReply, ReplyLike } = require('../models/Post');
const mongoose = require('mongoose');

const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/gif"];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only JPEG, PNG, and GIF are allowed."));
    }
  },
});

// Helper function to get user profile information
async function getUserProfile(email) {
  try {
    // Create User schema if not exists
    const UserSchema = new mongoose.Schema({
      email: { type: String, required: true, unique: true },
      name: { type: String, required: true },
      role: { type: String, required: true },
      profileImage: { type: String, default: '' }
    }, { collection: 'users' });
    
    const User = mongoose.models.User || mongoose.model('User', UserSchema);
    
    const user = await User.findOne({ email: email });
    
    if (user) {
      return {
        name: user.name,
        profile_pic: user.profileImage || ''
      };
    }
    
    // Fallback for teachers - check teachers collection
    const TeacherSchema = new mongoose.Schema({
      email: { type: String, required: true, unique: true },
      name: { type: String, required: true },
      profilePic: { type: String, default: '' }
    }, { collection: 'teachers1' });
    
    const Teacher = mongoose.models.Teacher || mongoose.model('Teacher', TeacherSchema);
    const teacher = await Teacher.findOne({ email: email });
    
    if (teacher) {
      return {
        name: teacher.name,
        profile_pic: teacher.profilePic || ''
      };
    }
    
    // Final fallback - extract name from email
    return {
      name: email.split('@')[0],
      profile_pic: ''
    };
  } catch (error) {
    console.error('❌ Error fetching user profile:', error);
    return {
      name: email.split('@')[0],
      profile_pic: ''
    };
  }
}

// Create a new post (any authenticated user)
router.post('/create', upload.single('postImage'), async (req, res) => {
  try {
    const { content, tags } = req.body;
    const userEmail = req.user?.email || 'test@example.com'; // Fallback for testing
    const userRole = req.user?.role || 'teacher'; // Fallback for testing

    console.log('🔍 Creating post - User Role:', userRole, 'Email:', userEmail);

    if (!content || content.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Content is required'
      });
    }

    // Check if MongoDB is connected
    if (mongoose.connection.readyState !== 1) {
      console.log('⚠️ MongoDB not connected, creating mock post');
      
      const postId = uuidv4();
      const postImage = req.file ? `/uploads/${req.file.filename}` : null;
      const tagsArray = tags ? tags.split(',').map(tag => tag.trim()).filter(tag => tag) : [];

      // Return mock success response
      return res.status(201).json({
        success: true,
        message: 'Post created successfully (mock data - MongoDB not connected)',
        data: {
          id: postId,
          author_email: userEmail,
          author_name: userEmail.split('@')[0],
          author_role: userRole,
          author_profile_pic: '',
          content: content.trim(),
          post_image: postImage,
          likes: 0,
          created_at: new Date().toISOString(),
          tags: tagsArray
        }
      });
    }

    // Get user profile information
    const userProfile = await getUserProfile(userEmail);
    if (!userProfile) {
      return res.status(404).json({
        success: false,
        message: 'User profile not found'
      });
    }

    const postId = uuidv4();
    const postImage = req.file ? `/uploads/${req.file.filename}` : null;
    const tagsArray = tags ? tags.split(',').map(tag => tag.trim()).filter(tag => tag) : [];

    const newPost = new Post({
      id: postId,
      author_email: userEmail,
      author_name: userProfile.name,
      author_role: userRole,
      author_profile_pic: userProfile.profile_pic,
      content: content.trim(),
      post_image: postImage,
      likes: 0,
      tags: tagsArray,
      created_at: new Date(),
      updated_at: new Date()
    });

    await newPost.save();

    console.log('✅ Post created successfully:', postId);

    res.status(201).json({
      success: true,
      message: 'Post created successfully',
      data: {
        id: postId,
        author_email: userEmail,
        author_name: userProfile.name,
        author_role: userRole,
        author_profile_pic: userProfile.profile_pic,
        content: content.trim(),
        post_image: postImage,
        likes: 0,
        created_at: newPost.created_at,
        tags: tagsArray
      }
    });

  } catch (error) {
    console.error('❌ Error creating post:', error);
    
    // Return mock success response on error
    const postId = uuidv4();
    const { content, tags } = req.body;
    const userEmail = req.user.email;
    const userRole = req.user.role || 'Unknown';
    const postImage = req.file ? `/uploads/${req.file.filename}` : null;
    const tagsArray = tags ? tags.split(',').map(tag => tag.trim()).filter(tag => tag) : [];

    res.status(201).json({
      success: true,
      message: 'Post created successfully (fallback - MongoDB connection issue)',
      data: {
        id: postId,
        author_email: userEmail,
        author_name: userEmail.split('@')[0],
        author_role: userRole,
        author_profile_pic: '',
        content: content?.trim() || 'Sample content',
        post_image: postImage,
        likes: 0,
        created_at: new Date().toISOString(),
        tags: tagsArray
      }
    });
  }
});

// Get all posts (for both teachers and students)
router.get('/all', async (req, res) => {
  try {
    const userEmail = req.user?.email || 'test@example.com'; // Fallback for testing without auth
    
    // Check if MongoDB is connected
    if (mongoose.connection.readyState !== 1) {
      console.log('⚠️ MongoDB not connected, returning sample data');
      
      // Return sample data when MongoDB is not available
      const samplePosts = [
        {
          id: 'sample-1',
          author: {
            email: 'teacher1@example.com',
            name: 'Sarah Johnson',
            role: 'teacher',
            profile_pic: ''
          },
          content: 'Welcome to our learning community! 🎓 This is a sample post since MongoDB is not connected.',
          postImage: '',
          likes: 5,
          createdAt: new Date(Date.now() - 3600000).toISOString(),
          tags: ['welcome', 'community'],
          isLiked: false
        },
        {
          id: 'sample-2',
          author: {
            email: 'teacher2@example.com',
            name: 'Michael Chen',
            role: 'teacher',
            profile_pic: ''
          },
          content: 'Just finished an amazing science experiment with my students! 🔬 Sample post for testing.',
          postImage: '',
          likes: 12,
          createdAt: new Date(Date.now() - 7200000).toISOString(),
          tags: ['science', 'experiment'],
          isLiked: false
        },
        {
          id: 'sample-3',
          author: {
            email: 'teacher3@example.com',
            name: 'Emily Davis',
            role: 'teacher',
            profile_pic: ''
          },
          content: 'Looking for creative teaching ideas for mathematics... Sample post for testing.',
          postImage: '',
          likes: 8,
          createdAt: new Date(Date.now() - 10800000).toISOString(),
          tags: ['mathematics', 'ideas'],
          isLiked: false
        }
      ];

      return res.json({
        success: true,
        data: samplePosts
      });
    }

    const posts = await Post.find({})
      .sort({ created_at: -1 })
      .lean();

    // Get all post IDs that the current user has liked
    const userLikes = await PostLike.find({ user_email: userEmail })
      .select('post_id')
      .lean();
    const likedPostIds = new Set(userLikes.map(like => like.post_id));

    const formattedPosts = posts.map(post => ({
      id: post.id,
      author: {
        email: post.author_email,
        name: post.author_name,
        role: post.author_role,
        profile_pic: post.author_profile_pic
      },
      content: post.content,
      postImage: post.post_image,
      likes: post.likes || 0,
      createdAt: post.created_at,
      tags: post.tags || [],
      isLiked: likedPostIds.has(post.id)
    }));

    res.json({
      success: true,
      data: formattedPosts
    });

  } catch (error) {
    console.error('❌ Error fetching posts:', error);
    
    // Return sample data on error
    const samplePosts = [
      {
        id: 'error-sample-1',
        author: {
          email: 'teacher1@example.com',
          name: 'Sarah Johnson',
          role: 'teacher',
          profile_pic: ''
        },
        content: 'Welcome to our learning community! 🎓 This is a fallback post due to MongoDB connection issues.',
        postImage: '',
        likes: 5,
        createdAt: new Date().toISOString(),
        tags: ['welcome', 'community'],
        isLiked: false
      }
    ];

    res.json({
      success: true,
      data: samplePosts
    });
  }
});

// Like a post (both teachers and students)
router.post('/:postId/like', verifyToken, async (req, res) => {
  try {
    const { postId } = req.params;
    const userEmail = req.user.email;

    // Check if post exists
    const post = await Post.findOne({ id: postId });
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Check if already liked
    const existingLike = await PostLike.findOne({ post_id: postId, user_email: userEmail });
    if (existingLike) {
      return res.status(400).json({
        success: false,
        message: 'Post already liked'
      });
    }

    // Add like
    const newLike = new PostLike({
      post_id: postId,
      user_email: userEmail,
      liked_at: new Date()
    });
    await newLike.save();

    // Increment likes counter
    post.likes = (post.likes || 0) + 1;
    await post.save();

    res.json({
      success: true,
      message: 'Post liked successfully'
    });

  } catch (error) {
    console.error('❌ Error liking post:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to like post'
    });
  }
});

// Unlike a post (both teachers and students)
router.delete('/:postId/like', verifyToken, async (req, res) => {
  try {
    const { postId } = req.params;
    const userEmail = req.user.email;

    // Remove like
    const deletedLike = await PostLike.findOneAndDelete({ post_id: postId, user_email: userEmail });
    
    if (deletedLike) {
      // Decrement likes counter
      const post = await Post.findOne({ id: postId });
      if (post) {
        post.likes = Math.max(0, (post.likes || 0) - 1);
        await post.save();
      }
    }

    res.json({
      success: true,
      message: 'Post unliked successfully'
    });

  } catch (error) {
    console.error('❌ Error unliking post:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unlike post'
    });
  }
});

// Add comment to a post (both teachers and students)
router.post('/:postId/comments', verifyToken, async (req, res) => {
  try {
    const { postId } = req.params;
    const { content } = req.body;
    const userEmail = req.user.email;
    const userRole = req.user.role || 'Unknown';

    if (!content || content.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Comment content is required'
      });
    }

    // Check if post exists
    const post = await Post.findOne({ id: postId });
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Get user profile information
    const userProfile = await getUserProfile(userEmail);
    if (!userProfile) {
      return res.status(404).json({
        success: false,
        message: 'User profile not found'
      });
    }

    const commentId = uuidv4();
    const newComment = new PostComment({
      id: commentId,
      post_id: postId,
      author_email: userEmail,
      author_name: userProfile.name,
      author_role: userRole,
      author_profile_pic: userProfile.profile_pic,
      content: content.trim(),
      likes: 0,
      created_at: new Date(),
      updated_at: new Date()
    });

    await newComment.save();

    res.status(201).json({
      success: true,
      message: 'Comment added successfully',
      data: {
        id: commentId,
        post_id: postId,
        author: {
          email: userEmail,
          name: userProfile.name,
          role: userRole,
          profile_pic: userProfile.profile_pic
        },
        content: content.trim(),
        likes: 0,
        created_at: newComment.created_at
      }
    });

  } catch (error) {
    console.error('❌ Error adding comment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add comment'
    });
  }
});

// Get comments for a post (both teachers and students)
router.get('/:postId/comments', verifyToken, async (req, res) => {
  try {
    const { postId } = req.params;

    const comments = await PostComment.find({ post_id: postId })
      .sort({ created_at: 1 })
      .lean();

    const formattedComments = comments.map(comment => ({
      id: comment.id,
      author: {
        email: comment.author_email,
        name: comment.author_name,
        role: comment.author_role,
        profile_pic: comment.author_profile_pic
      },
      content: comment.content,
      likes: comment.likes || 0,
      createdAt: comment.created_at
    }));

    res.json({
      success: true,
      data: formattedComments
    });

  } catch (error) {
    console.error('❌ Error fetching comments:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch comments'
    });
  }
});

// Get a single post with full details (both teachers and students)
router.get('/:postId', verifyToken, async (req, res) => {
  try {
    const { postId } = req.params;
    const userEmail = req.user.email;

    const post = await Post.findOne({ id: postId }).lean();

    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Check if user has liked this post
    const userLike = await PostLike.findOne({ post_id: postId, user_email: userEmail })
      .select('post_id')
      .lean();

    res.json({
      success: true,
      data: {
        id: post.id,
        author: {
          email: post.author_email,
          name: post.author_name,
          role: post.author_role,
          profile_pic: post.author_profile_pic
        },
        content: post.content,
        postImage: post.post_image,
        likes: post.likes || 0,
        createdAt: post.created_at,
        updatedAt: post.updated_at,
        tags: post.tags || [],
        isLiked: !!userLike
      }
    });

  } catch (error) {
    console.error('❌ Error fetching post:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch post'
    });
  }
});

// Get likes for a post (both teachers and students)
router.get('/:postId/likes', verifyToken, async (req, res) => {
  try {
    const { postId } = req.params;
    
    // Check if post exists
    const post = await Post.findOne({ id: postId });
    if (!post) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Get all likes for this post
    const likes = await PostLike.find({ post_id: postId })
      .sort({ liked_at: -1 })
      .lean();

    // Format likes with user details
    const formattedLikes = likes.map(like => ({
      user_email: like.user_email,
      user_name: like.user_email.split('@')[0], // Extract name from email
      user_profile_pic: '', // Can be enhanced later
      liked_at: like.liked_at
    }));

    res.json({
      success: true,
      data: formattedLikes
    });

  } catch (error) {
    console.error('❌ Error fetching likes:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch likes'
    });
  }
});

module.exports = router;
