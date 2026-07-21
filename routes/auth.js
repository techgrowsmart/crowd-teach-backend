const express = require("express");
const { v4: uuidv4 } = require("uuid");
const client = require("../config/db");
const transporter = require("../config/mail");
const jwt = require("jsonwebtoken")
const router = express.Router();


const generateOTP = () => Math.floor(1000 + Math.random() * 9000).toString();

router.post("/login", async (req, res) => {
    try {
        console.log("📥 Received Login Request:", req.body);
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ message: "Email is required" });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({ message: "Invalid email format" });
        }

        const userQuery = "SELECT * FROM users WHERE email = ?";
        const userResult = await client.execute(userQuery, [email], { prepare: true });

        if (userResult.rowLength === 0) {
            return res.status(404).json({
                message: "Your not registered. Please sign up first.",
                isRegistered: false,
            });
        }

        const user = userResult.rows[0];


        // Students should always be active, teachers can be active or dormant
        if (user.role === 'student' && user.status !== 'active') {
            // Auto-activate students if they're not active
            console.log(`📚 Auto-activating student: ${email}`);
            const updateQuery = "UPDATE users SET status = 'active' WHERE id = ?";
            await client.execute(updateQuery, [user.id], { prepare: true });
            user.status = 'active'; // Update in memory
        } else if (user.role === 'teacher' && user.status !== 'active' && user.status !== 'dormant' && user.status !== 'resubmit') {
            // Teachers must be active, dormant, or resubmit
            return res.status(403).json({
                message: "Your account is not active. Please contact support.",
                isRegistered: true,
                status: user.status,
                role: user.role,
            });
        }

        // ✅ Continue with OTP generation
        const otp = generateOTP();
        const otpId = uuidv4();
        const expirationTime = new Date(Date.now() + 2 * 60 * 1000);

        console.log(`🔢 Generated OTP: ${otp} for ${email}`);

        const insertOTPQuery =
            "INSERT INTO otp_table (id, email, otp, expires_at) VALUES (?, ?, ?, ?)";
        const params = [otpId, email, otp, expirationTime];
        await client.execute(insertOTPQuery, params, { prepare: true });

        const mailOptions = {
            from: `Your App <${process.env.EMAIL_USER}>`,
            to: email,
            subject: "Your Login OTP Code",
            text: `Your OTP code is: ${otp}. It is valid for 2 minutes.`,
        };

        try {
            await transporter.sendMail(mailOptions);
            console.log("✅ OTP Sent Successfully!");
        } catch (emailError) {
            console.error("❌ Error sending OTP via email:", emailError);
            console.log(`🔧 FALLBACK: OTP for ${email} is: ${otp} (valid for 2 minutes)`);
            // Continue with the flow even if email fails
        }

        res.json({
            message: "✅ OTP sent successfully",
            otpId,
            isRegistered: true,
            role: user.role,
        });
    } catch (error) {
        console.error("❌ Error sending OTP:", error);
        res.status(500).json({ message: "Failed to send OTP" });
    }
});


router.post("/verify-otp", async (req, res) => {
    try {
        const { email, otp, otpId } = req.body;
        if (!email || !otp || !otpId) {
            return res.status(400).json({ message: "❌ Email, OTP, and OTP ID are required" });
        }


        const query = "SELECT id, otp, expires_at FROM otp_table WHERE id = ? AND email = ?";
        const result = await client.execute(query, [otpId, email], { prepare: true });

        if (result.rowLength === 0) {
            return res.status(400).json({ message: "❌ OTP not found or expired" });
        }

        const latestOTP = result.rows[0];

        console.log("🔍 Stored OTP:", latestOTP.otp, " | User Entered OTP:", otp);

        if (latestOTP.otp.toString() !== otp.toString()) {
            return res.status(400).json({ message: "❌ Incorrect OTP" });
        }

        if (new Date(latestOTP.expires_at) < new Date()) {
            return res.status(400).json({ message: "❌ OTP has expired" });
        }


        const userQuery = "SELECT id, role, name FROM users WHERE email = ?";
        const userResult = await client.execute(userQuery, [email], { prepare: true });

        if (userResult.rowLength === 0) {
            return res.status(404).json({ message: "❌ User not found" });
        }

        const user = userResult.rows[0];
        const token = jwt.sign({
            userId: user.id,
            email: email,
            role: user.role,
            name: user.name
        }, process.env.JWT_SECRET_KEY, {expiresIn:'7d'})
        res.json({
            message: "✅ OTP verified successfully",
            role: user.role,
            name: user.name,
            token
        });
    } catch (error) {
        console.error("❌ Error verifying OTP:", error);
        res.status(500).json({ message: "Failed to verify OTP" });
    }
});

// Refresh token endpoint for existing users
router.post('/refresh-token', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }
    
    // Get user info from Cassandra
    const userQuery = "SELECT id, role, name FROM users WHERE email = ? ALLOW FILTERING";
    const userResult = await client.execute(userQuery, [email], { prepare: true });
    
    if (userResult.rowLength === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    
    const user = userResult.rows[0];
    
    // Create new token with role and name
    const token = jwt.sign({
      userId: user.id,
      email: email,
      role: user.role,
      name: user.name
    }, process.env.JWT_SECRET_KEY, { expiresIn: '7d' });
    
    res.json({
      success: true,
      message: 'Token refreshed successfully',
      role: user.role,
      name: user.name,
      token
    });
  } catch (error) {
    console.error('Error refreshing token:', error);
    res.status(500).json({ message: 'Failed to refresh token' });
  }
});

// Admin password-based login (for dashboard access)
router.post('/admin-login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }
    
    // Get user info from Cassandra
    const userQuery = "SELECT * FROM users WHERE email = ? ALLOW FILTERING";
    const userResult = await client.execute(userQuery, [email], { prepare: true });
    
    if (userResult.rowLength === 0) {
      // Auto-create admin user if it doesn't exist (for development)
      console.log(`Creating admin user: ${email}`);
      const userId = uuidv4();
      const insertQuery = "INSERT INTO users (id, email, name, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)";
      await client.execute(insertQuery, [userId, email, 'Admin', 'admin', 'active', new Date()], { prepare: true });
      
      const user = { id: userId, email, name: 'Admin', role: 'admin', status: 'active' };
      
      // Simple password check
      const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
      if (password !== adminPassword) {
        return res.status(401).json({ message: 'Invalid password' });
      }
      
      // Create JWT token
      const token = jwt.sign({
        userId: user.id,
        email: email,
        role: user.role,
        name: user.name
      }, process.env.JWT_SECRET_KEY, { expiresIn: '7d' });
      
      res.json({
        success: true,
        message: 'Admin user created and logged in successfully',
        token,
        user: {
          email: user.email,
          name: user.name,
          role: user.role
        }
      });
      return;
    }
    
    const user = userResult.rows[0];
    
    // Check if user is admin
    if (user.role !== 'admin' && user.role !== 'superadmin') {
      return res.status(403).json({ message: 'Access denied. Admin role required.' });
    }
    
    // Check if user is active
    if (user.status !== 'active') {
      return res.status(403).json({ message: 'Account is not active' });
    }
    
    // Simple password check (in production, use bcrypt)
    // For now, we'll accept any password for admin users in development
    // TODO: Implement proper password hashing
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    
    if (password !== adminPassword) {
      return res.status(401).json({ message: 'Invalid password' });
    }
    
    // Create JWT token
    const token = jwt.sign({
      userId: user.id,
      email: email,
      role: user.role,
      name: user.name
    }, process.env.JWT_SECRET_KEY, { expiresIn: '7d' });
    
    res.json({
      success: true,
      message: 'Admin login successful',
      token,
      user: {
        email: user.email,
        name: user.name,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ message: 'Failed to login' });
  }
});

// Check if user exists endpoint
router.post('/check-user', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }
    
    // Check if user exists in database
    const userQuery = "SELECT role, name, status FROM users WHERE email = ? ALLOW FILTERING";
    const userResult = await client.execute(userQuery, [email], { prepare: true });
    
    if (userResult.rowLength === 0) {
      return res.json({
        exists: false,
        message: 'User not found'
      });
    }
    
    const user = userResult.rows[0];
    
    res.json({
      exists: true,
      role: user.role,
      name: user.name,
      status: user.status,
      message: 'User found'
    });
    
  } catch (error) {
    console.error("Error checking user:", error);
    res.status(500).json({ message: "Failed to check user" });
  }
});

// Update user role after signup
router.post('/update-role', async (req, res) => {
  try {
    const { email, role } = req.body;
    
    if (!email || !role) {
      return res.status(400).json({ message: 'Email and role are required' });
    }
    
    if (!['student', 'teacher'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role. Must be student or teacher' });
    }
    
    // Find user by email first (Cassandra needs primary key for UPDATE)
    const findUserQuery = "SELECT id, name, phonenumber FROM users WHERE email = ? ALLOW FILTERING";
    const userResult = await client.execute(findUserQuery, [email], { prepare: true });
    
    if (userResult.rowLength === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    const userId = userResult.rows[0].id;
    const userName = userResult.rows[0].name || email.split('@')[0];
    const userPhone = userResult.rows[0].phonenumber || '';
    
    // Update user role and status in database using id (primary key)
    const updateQuery = "UPDATE users SET role = ?, status = ? WHERE id = ?";
    // All users start as 'active'
    const status = 'active';
    await client.execute(updateQuery, [role, status, userId], { prepare: true });
    
    // Insert role-specific record
    if (role === 'teacher') {
      const insertTeacherQuery = "INSERT INTO teachers1 (email, name) VALUES (?, ?)";
      await client.execute(insertTeacherQuery, [email, userName], { prepare: true });
    } else {
      const insertStudentQuery = "INSERT INTO student (email, name, phone_number) VALUES (?, ?, ?)";
      await client.execute(insertStudentQuery, [email, userName, userPhone], { prepare: true });
    }
    
    // Generate new token with updated role
    const token = jwt.sign({
      userId: userId,
      email: email,
      role: role,
      name: userName
    }, process.env.JWT_SECRET_KEY, { expiresIn: '7d' });
    
    res.json({
      success: true,
      message: 'Role updated successfully',
      role: role,
      token: token
    });
    
  } catch (error) {
    console.error("❌ Error updating role:", error);
    console.error("Error details:", error.message);
    console.error("Stack trace:", error.stack);
    res.status(500).json({ message: "Failed to update role: " + error.message });
  }
});

// Google OAuth login endpoint

router.post('/google-login', async (req, res) => {
  try {
    const { email, googleToken, name } = req.body;
    
    if (!email || !googleToken) {
      return res.status(400).json({ message: 'Email and Google token are required' });
    }
    
    // Verify Google token with Google's API
    const googleResponse = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${googleToken}`);
    const googleData = await googleResponse.json();
    
    if (googleData.error) {
      console.error('Google token verification failed:', googleData);
      return res.status(401).json({ message: 'Invalid Google token' });
    }
    
    // Verify the email matches
    if (googleData.email !== email) {
      return res.status(401).json({ message: 'Email mismatch' });
    }
    
    // Check if user exists in database
    const userQuery = "SELECT * FROM users WHERE email = ? ALLOW FILTERING";
    const userResult = await client.execute(userQuery, [email], { prepare: true });
    
    let user;
    if (userResult.rowLength === 0) {
      // User doesn't exist - this shouldn't happen since frontend checks first
      return res.status(404).json({ message: 'User not found. Please sign up first.' });
    } else {
      user = userResult.rows[0];
    }
    
    // Students should always be active, teachers can be active, dormant, or resubmit
    if (user.role === 'student' && user.status !== 'active') {
      // Auto-activate students if they're not active
      console.log(`📚 Auto-activating student for Google login: ${email}`);
      const updateQuery = "UPDATE users SET status = 'active' WHERE id = ?";
      await client.execute(updateQuery, [user.id], { prepare: true });
      user.status = 'active'; // Update in memory
    } else if (user.role === 'teacher' && user.status !== 'active' && user.status !== 'dormant' && user.status !== 'resubmit') {
      // Teachers must be active, dormant, or resubmit
      return res.status(403).json({
        message: 'Your account is not active. Please contact support.',
        status: user.status,
        role: user.role
      });
    }
    
    // Generate JWT token
    const token = jwt.sign({
      userId: user.id,
      email: user.email,
      role: user.role,
      name: user.name || name
    }, process.env.JWT_SECRET_KEY, { expiresIn: '7d' });
    
    res.json({
      success: true,
      message: 'Google login successful',
      token: token,
      user: {
        email: user.email,
        role: user.role,
        name: user.name || name
      }
    });
    
  } catch (error) {
    console.error('Google login error:', error);
    res.status(500).json({ message: 'Failed to login with Google' });
  }
});

module.exports = router;
