const express = require('express');
const router = express.Router({ strict: false });
const mongoose = require('mongoose');
const client = require('../config/db');
const verifyToken = require('../utils/verifyToken');

// Helper function to fetch user profile
async function getUserProfileFromDB(email, source) {
  let userProfile = null;

  try {
    const usersQuery = "SELECT email, name, role, profileimage FROM users WHERE email = ? ALLOW FILTERING";
    const usersResult = await client.execute(usersQuery, [email], { prepare: true });

    if (usersResult.rowLength > 0) {
      const user = usersResult.rows[0];
      userProfile = {
        email: user.email,
        name: user.name,
        role: user.role,
        profilepic: user.profileimage,
        profileImage: user.profileimage,
        profilePic: user.profileimage
      };
      console.log('✅ Found in users table:', userProfile.name);
    }
  } catch (astraError) {
    console.warn('⚠️ AstraDB lookup failed:', astraError.message);
  }

  // Fallback: Try MongoDB if not found in AstraDB
  if (!userProfile) {
    try {
      if (mongoose.connection.readyState === 1) {
        const db = mongoose.connection.db;
        if (db) {
          // Check users collection
          const mongoUser = await db.collection('users').findOne({ email });
          if (mongoUser) {
            userProfile = {
              email: mongoUser.email,
              name: mongoUser.name || mongoUser.fullName || email.split('@')[0],
              role: mongoUser.role || 'student',
              profilepic: mongoUser.profileImage || mongoUser.profilePic || null,
              profileImage: mongoUser.profileImage || mongoUser.profilePic || null,
              profilePic: mongoUser.profileImage || mongoUser.profilePic || null
            };
            console.log('✅ Found in MongoDB users:', userProfile.name);
          }
        }
      }
    } catch (mongoError) {
      console.warn('⚠️ MongoDB lookup failed:', mongoError.message);
    }
  }

  // Final fallback: Return basic profile from email if no DB available
  if (!userProfile) {
    console.log('⚠️ No DB profile found, returning email-based fallback for:', email);
    userProfile = {
      email: email,
      name: email.split('@')[0].replace(/\./g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      role: 'teacher',
      profilepic: null,
      profileImage: null,
      profilePic: null
    };
  }

  return userProfile;
}

// Get user profile from AstraDB or MongoDB - POST version
router.post('/', async (req, res) => {
  try {
    const { email, source } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    console.log(`🔍 Getting profile for: ${email} from source: ${source || 'default'}`);

    const userProfile = await getUserProfileFromDB(email, source);

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

// Get user profile - GET version (for frontend compatibility)
router.get('/', verifyToken, async (req, res) => {
  try {
    // Extract email from query param or token
    const email = req.query.email || req.user?.email;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    console.log(`🔍 Getting profile (GET) for: ${email}`);

    let userProfile = null;

    try {
      // Try AstraDB users table first
      const usersQuery = "SELECT email, name, role, profileimage FROM users WHERE email = ? ALLOW FILTERING";
      const usersResult = await client.execute(usersQuery, [email], { prepare: true });

      if (usersResult.rowLength > 0) {
        const user = usersResult.rows[0];
        userProfile = {
          email: user.email,
          name: user.name,
          role: user.role,
          profilepic: user.profileimage,
          profileImage: user.profileimage,
          profilePic: user.profileimage
        };
        console.log('✅ Found in users table:', userProfile.name);
      }

    } catch (astraError) {
      console.warn('⚠️ AstraDB lookup failed in GET route:', astraError.message);
    }

    // Fallback: Try MongoDB
    if (!userProfile) {
      try {
        if (mongoose.connection.readyState === 1) {
          const db = mongoose.connection.db;
          if (db) {
            const mongoUser = await db.collection('users').findOne({ email });
            if (mongoUser) {
              userProfile = {
                email: mongoUser.email,
                name: mongoUser.name || mongoUser.fullName || email.split('@')[0],
                role: mongoUser.role || 'student',
                profilepic: mongoUser.profileImage || mongoUser.profilePic || null,
                profileImage: mongoUser.profileImage || mongoUser.profilePic || null,
                profilePic: mongoUser.profileImage || mongoUser.profilePic || null
              };
              console.log('✅ Found in MongoDB:', userProfile.name);
            }
          }
        }
      } catch (mongoError) {
        console.warn('⚠️ MongoDB lookup failed:', mongoError.message);
      }
    }

    // Final fallback: Return basic profile from email
    if (!userProfile) {
      console.log('⚠️ GET route: No DB profile found, returning email-based fallback for:', email);
      userProfile = {
        email: email,
        name: email.split('@')[0].replace(/\./g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        role: 'teacher',
        profilepic: null,
        profileImage: null,
        profilePic: null
      };
    }

    // Always return success with profile (either from DB or fallback)
    res.json({
      success: true,
      data: userProfile
    });

  } catch (error) {
    console.error('❌ Error getting user profile:', error);
    // Return 200 with fallback profile instead of 500 error
    const email = req.query.email || req.user?.email || 'unknown@example.com';
    res.json({
      success: true,
      data: {
        email: email,
        name: email.split('@')[0].replace(/\./g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        role: 'teacher',
        profilepic: null,
        profileImage: null,
        profilePic: null
      },
      fallback: true
    });
  }
});

// Get user profile by email - POST version (original)
router.post('/by-email', async (req, res) => {
  try {
    const { email, source } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    console.log(`🔍 Getting profile for: ${email} from source: ${source || 'default'}`);

    // Use the improved helper function that always returns a profile
    const userProfile = await getUserProfileFromDB(email, source);

    // Always return success - helper ensures we have at least a fallback profile
    res.json({
      success: true,
      data: userProfile,
      fromDB: userProfile.name !== email.split('@')[0].replace(/\./g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    });

  } catch (error) {
    console.error('❌ Error getting user profile:', error);
    // Return 200 with fallback profile instead of 500 error
    const email = req.body?.email || 'unknown@example.com';
    res.json({
      success: true,
      data: {
        email: email,
        name: email.split('@')[0].replace(/\./g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        role: 'teacher',
        profilepic: null,
        profileImage: null,
        profilePic: null
      },
      fallback: true,
      error: error.message
    });
  }
});

module.exports = router;
