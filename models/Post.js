const mongoose = require('mongoose');

// Post Schema
const postSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true
  },
  author_email: {
    type: String,
    required: true,
    index: true
  },
  author_name: {
    type: String,
    required: true
  },
  author_role: {
    type: String,
    required: true,
    enum: ['teacher', 'student']
  },
  author_profile_pic: {
    type: String,
    default: ''
  },
  content: {
    type: String,
    required: true,
    maxlength: 2000
  },
  post_image: {
    type: String,
    default: ''
  },
  likes: {
    type: Number,
    default: 0,
    min: 0
  },
  tags: [{
    type: String,
    trim: true
  }],
  created_at: {
    type: Date,
    default: Date.now,
    index: true
  },
  updated_at: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  collection: 'posts'
});

// Post Likes Schema
const postLikeSchema = new mongoose.Schema({
  post_id: {
    type: String,
    required: true,
    ref: 'Post'
  },
  user_email: {
    type: String,
    required: true
  },
  liked_at: {
    type: Date,
    default: Date.now
  }
}, {
  collection: 'post_likes'
});

// Post Comments Schema
const postCommentSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true
  },
  post_id: {
    type: String,
    required: true,
    ref: 'Post',
    index: true
  },
  author_email: {
    type: String,
    required: true
  },
  author_name: {
    type: String,
    required: true
  },
  author_role: {
    type: String,
    required: true,
    enum: ['teacher', 'student']
  },
  author_profile_pic: {
    type: String,
    default: ''
  },
  content: {
    type: String,
    required: true,
    maxlength: 1000
  },
  likes: {
    type: Number,
    default: 0,
    min: 0
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  updated_at: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  collection: 'post_comments'
});

// Comment Likes Schema
const commentLikeSchema = new mongoose.Schema({
  comment_id: {
    type: String,
    required: true,
    ref: 'PostComment'
  },
  user_email: {
    type: String,
    required: true
  },
  liked_at: {
    type: Date,
    default: Date.now
  }
}, {
  collection: 'comment_likes'
});

// Comment Replies Schema
const commentReplySchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true
  },
  comment_id: {
    type: String,
    required: true,
    ref: 'PostComment',
    index: true
  },
  post_id: {
    type: String,
    required: true,
    ref: 'Post'
  },
  author_email: {
    type: String,
    required: true
  },
  author_name: {
    type: String,
    required: true
  },
  author_role: {
    type: String,
    required: true,
    enum: ['teacher', 'student']
  },
  author_profile_pic: {
    type: String,
    default: ''
  },
  content: {
    type: String,
    required: true,
    maxlength: 1000
  },
  likes: {
    type: Number,
    default: 0,
    min: 0
  },
  created_at: {
    type: Date,
    default: Date.now
  },
  updated_at: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  collection: 'comment_replies'
});

// Reply Likes Schema
const replyLikeSchema = new mongoose.Schema({
  reply_id: {
    type: String,
    required: true,
    ref: 'CommentReply'
  },
  user_email: {
    type: String,
    required: true
  },
  liked_at: {
    type: Date,
    default: Date.now
  }
}, {
  collection: 'reply_likes'
});

// Create compound indexes for better performance
postLikeSchema.index({ post_id: 1, user_email: 1 }, { unique: true });
commentLikeSchema.index({ comment_id: 1, user_email: 1 }, { unique: true });
replyLikeSchema.index({ reply_id: 1, user_email: 1 }, { unique: true });

// Create models
const Post = mongoose.model('Post', postSchema);
const PostLike = mongoose.model('PostLike', postLikeSchema);
const PostComment = mongoose.model('PostComment', postCommentSchema);
const CommentLike = mongoose.model('CommentLike', commentLikeSchema);
const CommentReply = mongoose.model('CommentReply', commentReplySchema);
const ReplyLike = mongoose.model('ReplyLike', replyLikeSchema);

module.exports = {
  Post,
  PostLike,
  PostComment,
  CommentLike,
  CommentReply,
  ReplyLike
};
