const express = require('express');
const router = express.Router();
const client = require('../config/db');

// Get user profile from AstraDB test table
router.post('/userProfile', async (req, res) => {
  try {
    const { email, source } = req.body;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }
    
    console.log(`🔍 Getting profile for: ${email} from source: ${source || 'default'}`);
    
    let userProfile = null;
    
    if (source === 'astraDB') {
      // Try test table first
      const testQuery = "SELECT email, name, role, profilepic FROM test WHERE email = ? ALLOW FILTERING";
      const testResult = await client.execute(testQuery, [email], { prepare: true });
      
      if (testResult.rowLength > 0) {
        const testUser = testResult.rows[0];
        userProfile = {
          email: testUser.email,
          name: testUser.name,
          role: testUser.role,
          profilepic: testUser.profilepic,
          profileImage: testUser.profilepic,
          profilePic: testUser.profilepic
        };
        console.log('✅ Found in test table:', userProfile.name);
      }
    }
    
    // If not found in test table, try users table
    if (!userProfile) {
      const usersQuery = "SELECT email, name, role, profilepic FROM users WHERE email = ? ALLOW FILTERING";
      const usersResult = await client.execute(usersQuery, [email], { prepare: true });
      
      if (usersResult.rowLength > 0) {
        const user = usersResult.rows[0];
        userProfile = {
          email: user.email,
          name: user.name,
          role: user.role,
          profilepic: user.profilepic,
          profileImage: user.profilepic,
          profilePic: user.profilepic
        };
        console.log('✅ Found in users table:', userProfile.name);
      }
    }
    
    if (userProfile) {
      res.json({
        success: true,
        data: userProfile
      });
    } else {
      res.json({
        success: false,
        message: 'User profile not found'
      });
    }
    
  } catch (error) {
    console.error('❌ Error getting user profile:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get user profile'
    });
  }
});

module.exports = router;
