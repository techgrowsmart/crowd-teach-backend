const client = require('./config/db');
const mongoose = require('mongoose');

const useTestTable = async () => {
  try {
    console.log('🔍 Using existing test table data...\n');
    
    // Connect to MongoDB
    const mongoURI = 'mongodb+srv://secretprovider669:SldOANXwCcco4MZ3@gogrowsmart.sgl2ens.mongodb.net/?retryWrites=true&w=majority&appName=gogrowsmart';
    
    await mongoose.connect(mongoURI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      dbName: 'gogrowsmart'
    });
    
    const db = mongoose.connection.db;
    const postsCollection = db.collection('posts');
    
    // Get all data from test table
    console.log('📋 Fetching data from test table...');
    const testQuery = "SELECT email, name, role, profilepic FROM test ALLOW FILTERING";
    const testResult = await client.execute(testQuery, [], { prepare: true });
    
    console.log(`✅ Found ${testResult.rowLength} entries in test table:`);
    const testUsers = testResult.rows.map(user => ({
      email: user.email,
      name: user.name,
      role: user.role,
      profile_pic: user.profilepic || ''
    }));
    
    testUsers.forEach((user, index) => {
      console.log(`   ${index + 1}. ${user.name} (${user.email}) - Role: ${user.role}`);
      console.log(`      Profile: ${user.profile_pic || 'None'}`);
    });
    
    // Clear existing posts
    console.log('\n🗑️  Clearing existing posts from MongoDB...');
    await postsCollection.deleteMany({});
    
    // Create posts from test table users
    const postsFromTestTable = [];
    
    testUsers.forEach((user, index) => {
      if (user.email && user.name) {
        const postId = `test-user-${Date.now()}-${index + 1}`;
        
        let content = '';
        let tags = [];
        
        // Create content based on role
        if (user.role === 'teacher') {
          content = `Hello everyone! I'm ${user.name} and I'm excited to share knowledge with my students. Let's learn and grow together!`;
          tags = ['teaching', 'education', 'learning'];
        } else if (user.role === 'admin') {
          content = `Welcome to our platform! I'm ${user.name} and I'm here to help manage and improve our learning community.`;
          tags = ['administration', 'management', 'community'];
        } else {
          content = `Hi everyone! I'm ${user.name} and I'm happy to be part of this learning journey.`;
          tags = ['learning', 'community', 'education'];
        }
        
        postsFromTestTable.push({
          id: postId,
          author_email: user.email,
          author_name: user.name,
          author_role: user.role,
          author_profile_pic: user.profile_pic,
          content: content,
          post_image: null,
          likes: Math.floor(Math.random() * 20) + 5,
          tags: tags,
          created_at: new Date(Date.now() - (index * 3600000)), // Different times
          updated_at: new Date(Date.now() - (index * 3600000))
        });
      }
    });
    
    // Insert posts from test table
    if (postsFromTestTable.length > 0) {
      await postsCollection.insertMany(postsFromTestTable);
      console.log(`\n✅ Created ${postsFromTestTable.length} posts from test table data:`);
      
      postsFromTestTable.forEach((post, index) => {
        console.log(`   ${index + 1}. ${post.author_name} (${post.author_role}) - ${post.author_email}`);
        console.log(`      Content: ${post.content.substring(0, 80)}...`);
        console.log(`      Likes: ${post.likes}`);
        console.log(`      Tags: ${post.tags.join(', ')}`);
        console.log('');
      });
    }
    
    await mongoose.disconnect();
    
    console.log('\n🎉 Successfully used test table data!');
    console.log('📱 Your app will now show posts with real users from test table');
    console.log('🎯 No mock data - only real test table users');
    
  } catch (error) {
    console.error('❌ Error using test table:', error.message);
  }
};

useTestTable();
