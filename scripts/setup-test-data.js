const client = require('../config/db');
const { v4: uuidv4 } = require('uuid');

async function setupTestData() {
  try {
    console.log('🔧 Setting up test data for thoughts, posts, and likes...');

    // Create test users if they don't exist
    const testUsers = [
      { email: 'teacher56@example.com', name: 'Test Teacher', role: 'teacher' },
      { email: 'student1@example.com', name: 'Test Student', role: 'student' },
      { email: 'teacher31@example.com', name: 'Demo Teacher', role: 'teacher' }
    ];

    for (const user of testUsers) {
      const userQuery = 'SELECT * FROM users WHERE email = ?';
      const userResult = await client.execute(userQuery, [user], { prepare: true });

      if (userResult.rowLength === 0) {
        const insertUserQuery = 'INSERT INTO users (id, email, name, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)';
        const userId = uuidv4();
        await client.execute(insertUserQuery, [
          userId,
          user.email,
          user.name,
          user.role,
          'active',
          new Date()
        ], { prepare: true });

        // Insert role-specific data
        if (user.role === 'teacher') {
          const insertTeacherQuery = 'INSERT INTO teachers1 (email, name) VALUES (?, ?)';
          await client.execute(insertTeacherQuery, [user.email, user.name], { prepare: true });
        } else {
          const insertStudentQuery = 'INSERT INTO student (email, name, phone_number) VALUES (?, ?, ?)';
          await client.execute(insertStudentQuery, [user.email, user.name, '+910000000000'], { prepare: true });
        }

        console.log(`✅ Created test user: ${user.email}`);
      }
    }

    // Create sample posts
    const samplePosts = [
      {
        author_email: 'teacher56@example.com',
        content: 'Teaching mathematics is not just about numbers, it\'s about building problem-solving skills that last a lifetime! 🧮✨',
        tags: ['mathematics', 'education', 'problem-solving']
      },
      {
        author_email: 'teacher31@example.com',
        content: 'Just finished an amazing science session with my students! Their curiosity about the world around them never ceases to amaze me. 🔬🌟',
        tags: ['science', 'curiosity', 'learning']
      },
      {
        author_email: 'teacher56@example.com',
        content: 'Remember: Every student learns differently. The key is to find what sparks their interest and build from there! 📚💡',
        tags: ['teaching', 'personalization', 'motivation']
      }
    ];

    for (const postData of samplePosts) {
      const postId = uuidv4();
      
      // Get author info
      const userQuery = 'SELECT name, role, profileimage FROM users WHERE email = ? ALLOW FILTERING';
      const userResult = await client.execute(userQuery, [postData.author_email], { prepare: true });
      
      if (userResult.rowLength > 0) {
        const user = userResult.rows[0];
        
        const insertPostQuery = `
          INSERT INTO posts (
            id, author_email, author_name, author_role, author_profile_pic,
            content, likes_counter, created_at, updated_at, tags
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        await client.execute(insertPostQuery, [
          postId,
          postData.author_email,
          user.name,
          user.role,
          user.profileimage,
          postData.content,
          Math.floor(Math.random() * 20), // Random likes between 0-20
          new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000), // Random time in last week
          new Date(),
          postData.tags
        ], { prepare: true });

        console.log(`✅ Created sample post by ${postData.author_email}`);

        // Add some random likes
        const likeCount = Math.floor(Math.random() * 5);
        for (let i = 0; i < likeCount; i++) {
          const likerEmail = testUsers[Math.floor(Math.random() * testUsers.length)].email;
          if (likerEmail !== postData.author_email) {
            const insertLikeQuery = 'INSERT INTO post_likes (post_id, user_email, liked_at) VALUES (?, ?, ?)';
            await client.execute(insertLikeQuery, [
              postId,
              likerEmail,
              new Date(Date.now() - Math.random() * 24 * 60 * 60 * 1000)
            ], { prepare: true });
          }
        }
      }
    }

    // Create sample comments
    const postsQuery = 'SELECT id, author_email FROM posts LIMIT 2';
    const postsResult = await client.execute(postsQuery, [], { prepare: true });

    for (const post of postsResult.rows) {
      const commentId = uuidv4();
      const commenterEmail = 'student1@example.com';
      
      // Get commenter info
      const userQuery = 'SELECT name, role, profileimage FROM users WHERE email = ? ALLOW FILTERING';
      const userResult = await client.execute(userQuery, [commenterEmail], { prepare: true });
      
      if (userResult.rowLength > 0) {
        const user = userResult.rows[0];
        
        const insertCommentQuery = `
          INSERT INTO post_comments (
            id, post_id, author_email, author_name, author_role,
            author_profile_pic, content, likes_counter, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        await client.execute(insertCommentQuery, [
          commentId,
          post.id,
          commenterEmail,
          user.name,
          user.role,
          user.profileimage,
          'Thank you for sharing this! Very helpful and inspiring post. 🙏',
          Math.floor(Math.random() * 5),
          new Date(),
          new Date()
        ], { prepare: true });

        console.log(`✅ Created sample comment on post by ${post.author_email}`);
      }
    }

    console.log('🎉 Test data setup completed successfully!');
    console.log('📊 Summary:');
    console.log(`   - Created ${testUsers.length} test users`);
    console.log(`   - Created ${samplePosts.length} sample posts`);
    console.log(`   - Added random likes and comments`);
    
  } catch (error) {
    console.error('❌ Error setting up test data:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  setupTestData()
    .then(() => {
      console.log('✅ Test data setup complete');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Test data setup failed:', error);
      process.exit(1);
    });
}

module.exports = { setupTestData };
