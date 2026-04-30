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
    // First try to get from MongoDB users collection
    const UserSchema = new mongoose.Schema({
      email: { type: String, required: true, unique: true },
      name: { type: String, required: true },
      role: { type: String, required: true },
      profileImage: { type: String, default: '' }
    }, { collection: 'users' });
    
    const User = mongoose.models.User || mongoose.model('User', UserSchema);
    
    const user = await User.findOne({ email: email });
    
    if (user) {
      console.log('✅ Found user in MongoDB:', { email, name: user.name, profileImage: user.profileImage });
      return {
        name: user.name,
        profile_pic: user.profileImage || ''
      };
    }
    
    // If not found in MongoDB, try to get from Cassandra for teachers
    const cassandraClient = require('../config/db');
    
    // Try teachers1 table first
    const teacherQuery = "SELECT name, profilepic FROM teachers1 WHERE email = ? ALLOW FILTERING";
    const teacherResult = await cassandraClient.execute(teacherQuery, [email], { prepare: true });
    
    if (teacherResult.rowLength > 0) {
      const teacher = teacherResult.rows[0];
      const profilePic = teacher.profilepic || '';
      console.log('✅ Found teacher in Cassandra teachers1:', { email, name: teacher.name, profilePic });
      return {
        name: teacher.name || email.split('@')[0],
        profile_pic: profilePic
      };
    }
    
    // Try users table in Cassandra
    const userQuery = "SELECT name, profileimage FROM users WHERE email = ? ALLOW FILTERING";
    const userResult = await cassandraClient.execute(userQuery, [email], { prepare: true });
    
    if (userResult.rowLength > 0) {
      const cassandraUser = userResult.rows[0];
      const profileImage = cassandraUser.profileimage || '';
      console.log('✅ Found user in Cassandra users:', { email, name: cassandraUser.name, profileImage });
      return {
        name: cassandraUser.name || email.split('@')[0],
        profile_pic: profileImage
      };
    }
    
    // Final fallback - extract name from email
    console.log('⚠️ Using fallback name from email:', email);
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

// Helper function to save base64 image to file
function saveBase64Image(base64String, filename) {
  try {
    // Remove data URL prefix if present
    const base64Data = base64String.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    const filepath = path.join(uploadDir, filename);
    fs.writeFileSync(filepath, buffer);
    return `/uploads/${filename}`;
  } catch (error) {
    console.error('❌ Error saving base64 image:', error);
    return null;
  }
}

// Create a new post (any authenticated user)
router.post('/create', verifyToken, (req, res, next) => {
  // Check if content-type is multipart (file upload) or JSON (base64)
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('multipart/form-data')) {
    upload.single('postImage')(req, res, next);
  } else {
    next();
  }
}, async (req, res) => {
  try {
    const { content, tags, postImage: imageUri } = req.body;
    const userEmail = req.user.email;
    const userRole = req.user.role || 'Unknown';

    console.log('🔍 Creating post - User Role:', userRole, 'Email:', userEmail);
    console.log('📸 Image data:', { hasFile: !!req.file, hasImageUri: !!imageUri });
    console.log('📦 Request body keys:', Object.keys(req.body));
    console.log('🖼️ req.body.postImage exists:', !!req.body.postImage);
    if (req.body.postImage) {
      console.log('🖼️ postImage starts with:', req.body.postImage.substring(0, 30));
    }

    if (!content || content.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Content is required'
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
    const tagsArray = tags ? tags.split(',').map(tag => tag.trim()).filter(tag => tag) : [];
    
    // Handle image from either file upload (mobile) or base64 URI (web)
    let postImage = null;
    if (req.file) {
      // File upload from mobile
      postImage = `/uploads/${req.file.filename}`;
    } else if (req.body.postImage && req.body.postImage.startsWith('data:image')) {
      // Base64 image from web - frontend sends as 'postImage'
      console.log('✅ Detected base64 image, saving...');
      const filename = `${Date.now()}.jpg`;
      postImage = saveBase64Image(req.body.postImage, filename);
      console.log('✅ Saved image to:', postImage);
    } else {
      console.log('❌ No image detected - req.file:', !!req.file, 'postImage check:', !!(req.body.postImage && req.body.postImage.startsWith('data:image')));
    }

    console.log('🖼️ Final post image path:', postImage);

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
    res.status(500).json({
      success: false,
      message: 'Failed to create post'
    });
  }
});

// Get all posts (for both teachers and students)
router.get('/all', verifyToken, async (req, res) => {
  try {
    const userEmail = req.user.email;
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
    res.status(500).json({
      success: false,
      message: 'Failed to fetch posts'
    });
  }
});

// GET /posts - Public endpoint for thoughtsCard (no authentication required)
router.get('/', async (req, res) => {
  try {
    console.log('🔍 Public posts endpoint accessed - fetching posts for thoughtsCard');
    
    const posts = await Post.find({})
      .sort({ created_at: -1 })
      .limit(50) // Limit to prevent large responses
      .lean();

    const formattedPosts = posts.map(post => ({
      id: post.id,
      author: {
        email: post.author_email,
        name: post.author_name,
        role: post.author_role,
        profile_pic: post.author_profile_pic || ''
      },
      content: post.content,
      postImage: post.post_image,
      likes: post.likes || 0,
      createdAt: post.created_at,
      tags: post.tags || [],
      isLiked: false // Public posts don't show like status
    }));

    console.log(`✅ Fetched ${formattedPosts.length} posts for thoughtsCard`);

    res.json({
      success: true,
      data: formattedPosts,
      total: formattedPosts.length
    });

  } catch (error) {
    console.error('❌ Error fetching public posts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch posts'
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
    const formattedLikes = await Promise.all(likes.map(async (like) => {
      // Get user profile information for each like
      const userProfile = await getUserProfile(like.user_email);
      
      return {
        user_email: like.user_email,
        user_name: userProfile.name,
        user_profile_pic: userProfile.profile_pic,
        liked_at: like.liked_at
      };
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

// Delete a post (author only, within 24 hours)
router.delete('/:postId', verifyToken, async (req, res) => {
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

    // Check if user is the author
    if (post.author_email !== userEmail) {
      return res.status(403).json({
        success: false,
        message: 'Only the author can delete this post'
      });
    }

    // Check if post is within 24 hours
    const postDate = new Date(post.created_at);
    const now = new Date();
    const diffHours = (now.getTime() - postDate.getTime()) / (1000 * 60 * 60);

    if (diffHours > 24) {
      return res.status(403).json({
        success: false,
        message: 'Posts can only be deleted within 24 hours of creation'
      });
    }

    // Delete post and related data
    await Post.deleteOne({ id: postId });
    await PostLike.deleteMany({ post_id: postId });
    await PostComment.deleteMany({ post_id: postId });
    await CommentReply.deleteMany({ post_id: postId });

    res.json({
      success: true,
      message: 'Post deleted successfully'
    });

  } catch (error) {
    console.error('❌ Error deleting post:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete post'
    });
  }
});

module.exports = router;
