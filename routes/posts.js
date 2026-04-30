const express = require('express');
const router = express.Router();
const verifyToken = require('../utils/verifyToken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const client = require('../config/db');

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

// Helper: Save base64 image to disk
const saveBase64Image = (base64String) => {
  try {
    if (!base64String || !base64String.startsWith('data:image')) {
      return null;
    }

    // Extract mime type and base64 data
    const matches = base64String.match(/^data:image\/([a-zA-Z]+);base64,(.+)$/);
    if (!matches) {
      return null;
    }

    const extension = matches[1] === 'jpeg' ? 'jpg' : matches[1];
    const base64Data = matches[2];
    const buffer = Buffer.from(base64Data, 'base64');

    // Generate unique filename
    const filename = `${Date.now()}-${uuidv4().slice(0, 8)}.${extension}`;
    const filepath = path.join(uploadDir, filename);

    // Write file
    fs.writeFileSync(filepath, buffer);

    return `/uploads/${filename}`;
  } catch (error) {
    console.error('❌ Error saving base64 image:', error);
    return null;
  }
};

// Create posts table if not exists
async function initPostsTable() {
  try {
    const query = `
      CREATE TABLE IF NOT EXISTS posts (
        id UUID PRIMARY KEY,
        author_email TEXT,
        author_name TEXT,
        author_role TEXT,
        author_profile_pic TEXT,
        content TEXT,
        post_image TEXT,
        likes_counter COUNTER,
        created_at TIMESTAMP,
        updated_at TIMESTAMP,
        tags SET<TEXT>
      );
    `;
    await client.execute(query);
    console.log('✅ Posts table initialized');
  } catch (error) {
    console.error('❌ Error creating posts table:', error);
  }
}

// Create likes table if not exists
async function initLikesTable() {
  try {
    const query = `
      CREATE TABLE IF NOT EXISTS post_likes (
        post_id UUID,
        user_email TEXT,
        liked_at TIMESTAMP,
        PRIMARY KEY (post_id, user_email)
      );
    `;
    await client.execute(query);
    console.log('✅ Post likes table initialized');
  } catch (error) {
    console.error('❌ Error creating post likes table:', error);
  }
}

// Create comments table if not exists
async function initCommentsTable() {
  try {
    const query = `
      CREATE TABLE IF NOT EXISTS post_comments (
        id UUID PRIMARY KEY,
        post_id UUID,
        author_email TEXT,
        author_name TEXT,
        author_role TEXT,
        author_profile_pic TEXT,
        content TEXT,
        likes_counter COUNTER,
        created_at TIMESTAMP,
        updated_at TIMESTAMP
      );
    `;
    await client.execute(query);
    console.log('✅ Post comments table initialized');
  } catch (error) {
    console.error('❌ Error creating post comments table:', error);
  }
}

// Create comment replies table if not exists
async function initRepliesTable() {
  try {
    const query = `
      CREATE TABLE IF NOT EXISTS comment_replies (
        id UUID PRIMARY KEY,
        comment_id UUID,
        post_id UUID,
        author_email TEXT,
        author_name TEXT,
        author_role TEXT,
        author_profile_pic TEXT,
        content TEXT,
        likes_counter COUNTER,
        created_at TIMESTAMP,
        updated_at TIMESTAMP
      );
    `;
    await client.execute(query);
    console.log('✅ Comment replies table initialized');
  } catch (error) {
    console.error('❌ Error creating comment replies table:', error);
  }
}

// Create comment likes table if not exists
async function initCommentLikesTable() {
  try {
    const query = `
      CREATE TABLE IF NOT EXISTS comment_likes (
        comment_id UUID,
        user_email TEXT,
        liked_at TIMESTAMP,
        PRIMARY KEY (comment_id, user_email)
      );
    `;
    await client.execute(query);
    console.log('✅ Comment likes table initialized');
  } catch (error) {
    console.error('❌ Error creating comment likes table:', error);
  }
}

// Create reply likes table if not exists
async function initReplyLikesTable() {
  try {
    const query = `
      CREATE TABLE IF NOT EXISTS reply_likes (
        reply_id UUID,
        user_email TEXT,
        liked_at TIMESTAMP,
        PRIMARY KEY (reply_id, user_email)
      );
    `;
    await client.execute(query);
    console.log('✅ Reply likes table initialized');
  } catch (error) {
    console.error('❌ Error creating reply likes table:', error);
  }
}

// Initialize tables
initPostsTable();
initLikesTable();
initCommentsTable();
initRepliesTable();
initCommentLikesTable();
initReplyLikesTable();

// Helper function to get user profile information
async function getUserProfile(email) {
  try {
    // Get basic user info
    const userQuery = 'SELECT name, role, profileimage FROM users WHERE email = ? ALLOW FILTERING';
    const userResult = await client.execute(userQuery, [email], { prepare: true });
    
    if (userResult.rowLength === 0) {
      return null;
    }
    
    const user = userResult.rows[0];
    
    // If teacher, get additional profile info
    if (user.role && user.role.toLowerCase() === 'teacher') {
      const teacherQuery = `
        SELECT profilepic, introduction 
        FROM teachers1 
        WHERE email = ?
      `;
      const teacherResult = await client.execute(teacherQuery, [email], { prepare: true });
      
      if (teacherResult.rowLength > 0) {
        const teacher = teacherResult.rows[0];
        return {
          name: user.name,
          role: user.role,
          profile_pic: teacher.profilepic || user.profileimage,
          introduction: teacher.introduction
        };
      }
    }
    
    return {
      name: user.name,
      role: user.role,
      profile_pic: user.profileimage,
      introduction: ''
    };
  } catch (error) {
    console.error('❌ Error fetching user profile:', error);
    return null;
  }
}

// Create a new post (teachers only)
router.post('/create', verifyToken, (req, res, next) => {
  // Check if content-type is multipart (file upload) or JSON (base64)
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('multipart/form-data')) {
    // Use multer for multipart uploads
    upload.single('postImage')(req, res, next);
  } else {
    // Skip multer for JSON requests (body already parsed)
    next();
  }
}, async (req, res) => {
  try {
    const { content, tags, email } = req.body;
    const userEmail = email || req.user.email; // Use email from body if provided (for frontend compatibility)
    const userRole = req.user.role || 'Unknown';

    // Check if user is a teacher
    if (userRole.toLowerCase() !== 'teacher') {
      return res.status(403).json({
        success: false,
        message: 'Only teachers can create posts'
      });
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
    // Handle both multipart file upload and base64 image from JSON body
    let postImage = null;
    if (req.file) {
      // Multipart upload
      postImage = `/uploads/${req.file.filename}`;
    } else if (req.body.postImage) {
      // Base64 image from JSON body
      postImage = saveBase64Image(req.body.postImage);
    }
    const tagsArray = tags ? tags.split(',').map(tag => tag.trim()).filter(tag => tag) : [];

    const query = `
      INSERT INTO posts (
        id, author_email, author_name, author_role, author_profile_pic,
        content, post_image, likes_counter, created_at, updated_at, tags
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const now = new Date();
    await client.execute(query, [
      postId,
      userEmail,
      userProfile.name,
      userRole,
      userProfile.profile_pic,
      content,
      postImage,
      0, // likes counter starts at 0
      now,
      now,
      tagsArray
    ], { prepare: true });

    res.status(201).json({
      success: true,
      message: 'Post created successfully',
      data: {
        id: postId,
        author_email: userEmail,
        author_name: userProfile.name,
        author_role: userRole,
        author_profile_pic: userProfile.profile_pic,
        content,
        post_image: postImage,
        likes: 0,
        created_at: now,
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
    const query = 'SELECT * FROM posts ORDER BY created_at DESC';
    const result = await client.execute(query);

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        data: [],
        message: 'No posts found'
      });
    }

    // Fetch author profile information for each post
    const postsWithAuthors = await Promise.all(
      result.rows.map(async (post) => {
        const authorProfile = await getUserProfile(post.author_email);
        return {
          ...post,
          author: {
            email: post.author_email,
            name: authorProfile?.name || 'Unknown',
            role: authorProfile?.role || 'Unknown',
            profile_pic: authorProfile?.profile_pic || null
          }
        };
      })
    );

    res.json({
      success: true,
      data: postsWithAuthors
    });
  } catch (error) {
    console.error('Error fetching posts:', error);
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
    const postQuery = `SELECT id FROM posts WHERE id = ?`;
    const postResult = await client.execute(postQuery, [postId], { prepare: true });

    if (postResult.rowLength === 0) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    // Check if already liked
    const likeCheckQuery = `SELECT user_email FROM post_likes WHERE post_id = ? AND user_email = ?`;
    const likeCheckResult = await client.execute(likeCheckQuery, [postId, userEmail], { prepare: true });

    if (likeCheckResult.rowLength > 0) {
      return res.status(400).json({
        success: false,
        message: 'Post already liked'
      });
    }

    // Add like
    const likeQuery = `INSERT INTO post_likes (post_id, user_email, liked_at) VALUES (?, ?, ?)`;
    await client.execute(likeQuery, [postId, userEmail, new Date()], { prepare: true });

    // Increment likes counter
    const updateQuery = `UPDATE posts SET likes_counter = likes_counter + 1 WHERE id = ?`;
    await client.execute(updateQuery, [postId], { prepare: true });

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
    const unlikeQuery = `DELETE FROM post_likes WHERE post_id = ? AND user_email = ?`;
    await client.execute(unlikeQuery, [postId, userEmail], { prepare: true });

    // Decrement likes counter
    const updateQuery = `UPDATE posts SET likes_counter = likes_counter - 1 WHERE id = ?`;
    await client.execute(updateQuery, [postId], { prepare: true });

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
    const postQuery = `SELECT id FROM posts WHERE id = ?`;
    const postResult = await client.execute(postQuery, [postId], { prepare: true });

    if (postResult.rowLength === 0) {
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
    const query = `
      INSERT INTO post_comments (
        id, post_id, author_email, author_name, author_role,
        author_profile_pic, content, likes_counter, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const now = new Date();
    await client.execute(query, [
      commentId,
      postId,
      userEmail,
      userProfile.name,
      userRole,
      userProfile.profile_pic,
      content,
      0, // likes counter starts at 0
      now,
      now
    ], { prepare: true });

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
        content,
        likes: 0,
        created_at: now
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

    const query = `
      SELECT id, author_email, author_name, author_role, author_profile_pic,
             content, likes_counter, created_at
      FROM post_comments
      WHERE post_id = ?
      ORDER BY created_at ASC
    `;

    const result = await client.execute(query, [postId], { prepare: true });
    const comments = result.rows.map(comment => ({
      id: comment.id.toString(),
      author: {
        email: comment.author_email,
        name: comment.author_name,
        role: comment.author_role,
        profile_pic: comment.author_profile_pic
      },
      content: comment.content,
      likes: comment.likes_counter,
      createdAt: comment.created_at
    }));

    res.json({
      success: true,
      data: comments
    });

  } catch (error) {
    console.error('❌ Error fetching comments:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch comments'
    });
  }
});

// Like a comment (both teachers and students)
router.post('/comments/:commentId/like', verifyToken, async (req, res) => {
  try {
    const { commentId } = req.params;
    const userEmail = req.user.email;

    // Check if comment exists
    const commentQuery = `SELECT id FROM post_comments WHERE id = ?`;
    const commentResult = await client.execute(commentQuery, [commentId], { prepare: true });

    if (commentResult.rowLength === 0) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found'
      });
    }

    // Check if already liked
    const likeCheckQuery = `SELECT user_email FROM comment_likes WHERE comment_id = ? AND user_email = ?`;
    const likeCheckResult = await client.execute(likeCheckQuery, [commentId, userEmail], { prepare: true });

    if (likeCheckResult.rowLength > 0) {
      return res.status(400).json({
        success: false,
        message: 'Comment already liked'
      });
    }

    // Add like
    const likeQuery = `INSERT INTO comment_likes (comment_id, user_email, liked_at) VALUES (?, ?, ?)`;
    await client.execute(likeQuery, [commentId, userEmail, new Date()], { prepare: true });

    // Increment likes counter
    const updateQuery = `UPDATE post_comments SET likes_counter = likes_counter + 1 WHERE id = ?`;
    await client.execute(updateQuery, [commentId], { prepare: true });

    res.json({
      success: true,
      message: 'Comment liked successfully'
    });

  } catch (error) {
    console.error('❌ Error liking comment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to like comment'
    });
  }
});

// Unlike a comment (both teachers and students)
router.delete('/comments/:commentId/like', verifyToken, async (req, res) => {
  try {
    const { commentId } = req.params;
    const userEmail = req.user.email;

    // Remove like
    const unlikeQuery = `DELETE FROM comment_likes WHERE comment_id = ? AND user_email = ?`;
    await client.execute(unlikeQuery, [commentId, userEmail], { prepare: true });

    // Decrement likes counter
    const updateQuery = `UPDATE post_comments SET likes_counter = likes_counter - 1 WHERE id = ?`;
    await client.execute(updateQuery, [commentId], { prepare: true });

    res.json({
      success: true,
      message: 'Comment unliked successfully'
    });

  } catch (error) {
    console.error('❌ Error unliking comment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unlike comment'
    });
  }
});

// Add reply to a comment (both teachers and students)
router.post('/comments/:commentId/replies', verifyToken, async (req, res) => {
  try {
    const { commentId } = req.params;
    const { content } = req.body;
    const userEmail = req.user.email;
    const userRole = req.user.role || 'Unknown';

    if (!content || content.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Reply content is required'
      });
    }

    // Check if comment exists and get post_id
    const commentQuery = `SELECT post_id FROM post_comments WHERE id = ?`;
    const commentResult = await client.execute(commentQuery, [commentId], { prepare: true });

    if (commentResult.rowLength === 0) {
      return res.status(404).json({
        success: false,
        message: 'Comment not found'
      });
    }

    const postId = commentResult.rows[0].post_id;

    // Get user profile information
    const userProfile = await getUserProfile(userEmail);
    if (!userProfile) {
      return res.status(404).json({
        success: false,
        message: 'User profile not found'
      });
    }

    const replyId = uuidv4();
    const query = `
      INSERT INTO comment_replies (
        id, comment_id, post_id, author_email, author_name, author_role,
        author_profile_pic, content, likes_counter, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const now = new Date();
    await client.execute(query, [
      replyId,
      commentId,
      postId,
      userEmail,
      userProfile.name,
      userRole,
      userProfile.profile_pic,
      content,
      0, // likes counter starts at 0
      now,
      now
    ], { prepare: true });

    res.status(201).json({
      success: true,
      message: 'Reply added successfully',
      data: {
        id: replyId,
        comment_id: commentId,
        post_id: postId,
        author: {
          email: userEmail,
          name: userProfile.name,
          role: userRole,
          profile_pic: userProfile.profile_pic
        },
        content,
        likes: 0,
        created_at: now
      }
    });

  } catch (error) {
    console.error('❌ Error adding reply:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add reply'
    });
  }
});

// Get replies for a comment (both teachers and students)
router.get('/comments/:commentId/replies', verifyToken, async (req, res) => {
  try {
    const { commentId } = req.params;

    const query = `
      SELECT id, author_email, author_name, author_role, author_profile_pic,
             content, likes_counter, created_at
      FROM comment_replies
      WHERE comment_id = ?
      ORDER BY created_at ASC
    `;

    const result = await client.execute(query, [commentId], { prepare: true });
    const replies = result.rows.map(reply => ({
      id: reply.id.toString(),
      author: {
        email: reply.author_email,
        name: reply.author_name,
        role: reply.author_role,
        profile_pic: reply.author_profile_pic
      },
      content: reply.content,
      likes: reply.likes_counter,
      createdAt: reply.created_at
    }));

    res.json({
      success: true,
      data: replies
    });

  } catch (error) {
    console.error('❌ Error fetching replies:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch replies'
    });
  }
});

// Like a reply (both teachers and students)
router.post('/replies/:replyId/like', verifyToken, async (req, res) => {
  try {
    const { replyId } = req.params;
    const userEmail = req.user.email;

    // Check if reply exists
    const replyQuery = `SELECT id FROM comment_replies WHERE id = ?`;
    const replyResult = await client.execute(replyQuery, [replyId], { prepare: true });

    if (replyResult.rowLength === 0) {
      return res.status(404).json({
        success: false,
        message: 'Reply not found'
      });
    }

    // Check if already liked
    const likeCheckQuery = `SELECT user_email FROM reply_likes WHERE reply_id = ? AND user_email = ?`;
    const likeCheckResult = await client.execute(likeCheckQuery, [replyId, userEmail], { prepare: true });

    if (likeCheckResult.rowLength > 0) {
      return res.status(400).json({
        success: false,
        message: 'Reply already liked'
      });
    }

    // Add like
    const likeQuery = `INSERT INTO reply_likes (reply_id, user_email, liked_at) VALUES (?, ?, ?)`;
    await client.execute(likeQuery, [replyId, userEmail, new Date()], { prepare: true });

    // Increment likes counter
    const updateQuery = `UPDATE comment_replies SET likes_counter = likes_counter + 1 WHERE id = ?`;
    await client.execute(updateQuery, [replyId], { prepare: true });

    res.json({
      success: true,
      message: 'Reply liked successfully'
    });

  } catch (error) {
    console.error('❌ Error liking reply:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to like reply'
    });
  }
});

// Unlike a reply (both teachers and students)
router.delete('/replies/:replyId/like', verifyToken, async (req, res) => {
  try {
    const { replyId } = req.params;
    const userEmail = req.user.email;

    // Remove like
    const unlikeQuery = `DELETE FROM reply_likes WHERE reply_id = ? AND user_email = ?`;
    await client.execute(unlikeQuery, [replyId, userEmail], { prepare: true });

    // Decrement likes counter
    const updateQuery = `UPDATE comment_replies SET likes_counter = likes_counter - 1 WHERE id = ?`;
    await client.execute(updateQuery, [replyId], { prepare: true });

    res.json({
      success: true,
      message: 'Reply unliked successfully'
    });

  } catch (error) {
    console.error('❌ Error unliking reply:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unlike reply'
    });
  }
});

// Get a single post with full details (both teachers and students)
router.get('/:postId', verifyToken, async (req, res) => {
  try {
    const { postId } = req.params;

    const query = `
      SELECT id, author_email, author_name, author_role, author_profile_pic,
             content, post_image, likes_counter, created_at, updated_at, tags
      FROM posts
      WHERE id = ?
    `;

    const result = await client.execute(query, [postId], { prepare: true });

    if (result.rowLength === 0) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    const post = result.rows[0];
    
    res.json({
      success: true,
      data: {
        id: post.id.toString(),
        author: {
          email: post.author_email,
          name: post.author_name,
          role: post.author_role,
          profile_pic: post.author_profile_pic
        },
        content: post.content,
        postImage: post.post_image,
        likes: post.likes_counter,
        createdAt: post.created_at,
        updatedAt: post.updated_at,
        tags: post.tags || []
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

// Edit a post (author only)
router.put('/:postId', verifyToken, upload.single('postImage'), async (req, res) => {
  try {
    const { postId } = req.params;
    const { content, tags } = req.body;
    const userEmail = req.user.email;

    if (!content || content.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Content is required'
      });
    }

    // Check if post exists and user is the author
    const postQuery = `SELECT author_email FROM posts WHERE id = ?`;
    const postResult = await client.execute(postQuery, [postId], { prepare: true });

    if (postResult.rowLength === 0) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    if (postResult.rows[0].author_email !== userEmail) {
      return res.status(403).json({
        success: false,
        message: 'Only the author can edit this post'
      });
    }

    // Update post
    const tagsArray = tags ? tags.split(',').map(tag => tag.trim()).filter(tag => tag) : [];
    const postImage = req.file ? `/uploads/${req.file.filename}` : null;

    let updateQuery = `
      UPDATE posts 
      SET content = ?, updated_at = ?, tags = ?
    `;
    let updateParams = [content, new Date(), tagsArray];

    if (postImage) {
      updateQuery += `, post_image = ?`;
      updateParams.push(postImage);
    }

    updateQuery += ` WHERE id = ?`;
    updateParams.push(postId);

    await client.execute(updateQuery, updateParams, { prepare: true });

    res.json({
      success: true,
      message: 'Post updated successfully'
    });

  } catch (error) {
    console.error('❌ Error updating post:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update post'
    });
  }
});

// Delete a post (author only, within 24 hours)
router.delete('/:postId', verifyToken, async (req, res) => {
  try {
    const { postId } = req.params;
    const userEmail = req.user.email;

    // Check if post exists and get author info and creation time
    const postQuery = `SELECT author_email, created_at FROM posts WHERE id = ?`;
    const postResult = await client.execute(postQuery, [postId], { prepare: true });

    if (postResult.rowLength === 0) {
      return res.status(404).json({
        success: false,
        message: 'Post not found'
      });
    }

    const post = postResult.rows[0];

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

    // Delete post (this will cascade delete likes and comments due to table design)
    const deleteQuery = `DELETE FROM posts WHERE id = ?`;
    await client.execute(deleteQuery, [postId], { prepare: true });

    // Clean up related data
    await client.execute(`DELETE FROM post_likes WHERE post_id = ?`, [postId], { prepare: true });
    
    // Get all comments for this post and delete them and their replies
    const commentsQuery = `SELECT id FROM post_comments WHERE post_id = ?`;
    const commentsResult = await client.execute(commentsQuery, [postId], { prepare: true });
    
    for (const comment of commentsResult.rows) {
      await client.execute(`DELETE FROM comment_replies WHERE comment_id = ?`, [comment.id], { prepare: true });
      await client.execute(`DELETE FROM comment_likes WHERE comment_id = ?`, [comment.id], { prepare: true });
    }
    
    await client.execute(`DELETE FROM post_comments WHERE post_id = ?`, [postId], { prepare: true });

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