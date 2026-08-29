const mongoose = require('mongoose');

const FollowSchema = new mongoose.Schema({
  follower_email: { type: String, required: true, index: true },   // the student
  following_email: { type: String, required: true, index: true },  // the teacher
  followed_at: { type: Date, default: Date.now }
});

// Prevents duplicate follows at the DB level — critical since you'll
// call this from multiple posts by the same teacher
FollowSchema.index({ follower_email: 1, following_email: 1 }, { unique: true });

module.exports = mongoose.model('Follow', FollowSchema);