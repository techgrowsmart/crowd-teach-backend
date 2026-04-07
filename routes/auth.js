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


        //  if (user.status !== "active"){
        if (user.status !== "active" && user.status !== "dormant") {
            return res.status(403).json({
                message: "Your account is not active. Please contact support.",
                isRegistered: true,
                status: user.status,
                role: user.role,
            });
        }

        // 🧪 Bypass OTP for test users (Google Play Console testing)
        const testUsers = ["student1@example.com", "teacher56@example.com", "teacher31@example.com"];
        if (testUsers.includes(email)) {
            console.log(`🧪 Test user detected: ${email} - Bypassing OTP`);
            
            // For teacher31@example.com, create user if doesn't exist
            if (email === 'teacher31@example.com' && !user) {
                const insertQuery = "INSERT INTO users (email, name, role, status) VALUES (?, ?, ?, ?)";
                await client.execute(insertQuery, [email, 'Test Teacher', 'teacher', 'active'], { prepare: true });
                
                const insertTeacherQuery = "INSERT INTO teachers1 (email, name) VALUES (?, ?)";
                await client.execute(insertTeacherQuery, [email, 'Test Teacher'], { prepare: true });
                
                user = { email, name: 'Test Teacher', role: 'teacher', status: 'active' };
            }
            
            const token = jwt.sign({
                email: email,
                role: user.role,
                name: user.name
            }, process.env.JWT_SECRET_KEY, {expiresIn:'7d'});
            
            return res.json({
                message: "✅ Login successful (test user)",
                role: user.role,
                token,
                name: user.name,
                isTestUser: true
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


        const userQuery = "SELECT role, name FROM users WHERE email = ?";
        const userResult = await client.execute(userQuery, [email], { prepare: true });

        if (userResult.rowLength === 0) {
            return res.status(404).json({ message: "❌ User not found" });
        }

        const user = userResult.rows[0];
        const token = jwt.sign({
            email: email,
            role: user.role,
            name: user.name
        }, process.env.JWT_SECRET_KEY, {expiresIn:'7d'})
        res.json({
            message: "✅ OTP verified successfully",
            role: user.role,
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
    const userQuery = "SELECT role, name FROM users WHERE email = ? ALLOW FILTERING";
    const userResult = await client.execute(userQuery, [email], { prepare: true });
    
    if (userResult.rowLength === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    
    const user = userResult.rows[0];
    
    // Create new token with role and name
    const token = jwt.sign({
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
    console.error("❌ Error refreshing token:", error);
    res.status(500).json({ message: "Failed to refresh token" });
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
    
    // Update user role in database using id (primary key)
    const updateQuery = "UPDATE users SET role = ? WHERE id = ?";
    await client.execute(updateQuery, [role, userId], { prepare: true });
    
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

module.exports = router;
