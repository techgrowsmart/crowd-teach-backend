const express = require("express");
const router = express.Router();
const client = require("../config/db");
const verifyToken = require("../utils/verifyToken");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key-change-in-production";
const JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || JWT_SECRET;

function checkAdminRole(req, res, next) {
  const adminRole = req.user.role;
  if (adminRole !== "admin" && adminRole !== "superadmin" && adminRole !== "moderator") {
    return res.status(403).json({ success: false, message: "Access denied" });
  }
  next();
}

// MongoDB schema for admin passwords
const AdminPasswordSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const AdminPassword = mongoose.models.AdminPassword || mongoose.model('AdminPassword', AdminPasswordSchema);

// POST /api/admin/admin-signup - Admin signup
router.post("/admin-signup", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required"
      });
    }

    // Validate email format
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid email address (e.g., user@example.com)"
      });
    }

    // Additional checks for common invalid patterns
    if (email.includes('..') || email.startsWith('.') || email.endsWith('.')) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid email address"
      });
    }

    if (email.length > 254) {
      return res.status(400).json({
        success: false,
        message: "Email address is too long"
      });
    }

    const localPart = email.split('@')[0];
    if (localPart.length > 64) {
      return res.status(400).json({
        success: false,
        message: "Email address is too long"
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters long"
      });
    }

    // Check if admin already exists in dashboard_users table
    const checkQuery = `SELECT email FROM dashboard_users WHERE email = ? ALLOW FILTERING`;
    const checkResult = await client.execute(checkQuery, [email], { prepare: true });

    if (checkResult.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists. Please login instead.",
        exists: true
      });
    }

    // Check if password already exists in MongoDB
    const existingPassword = await AdminPassword.findOne({ email });
    if (existingPassword) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists. Please login instead.",
        exists: true
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate UUID for user
    const userId = require('uuid').v4();

    // Insert new admin user into dashboard_users table
    const insertQuery = `INSERT INTO dashboard_users (id, email, name, role, status, created_at, actions)
                         VALUES (?, ?, ?, ?, ?, ?, ?)`;
    await client.execute(insertQuery, [
      userId,
      email,
      email.split('@')[0],
      'admin',
      'active',
      new Date(),
      [] // Empty actions list initially
    ], { prepare: true });

    // Store password hash in MongoDB
    await AdminPassword.create({
      email: email,
      passwordHash: hashedPassword
    });

    // Generate JWT token
    const token = jwt.sign(
      { id: userId, email, role: 'admin' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    console.log("✅ Admin signup successful:", email);

    res.json({
      success: true,
      message: "Admin account created successfully",
      token,
      user: {
        id: userId,
        email,
        role: 'admin'
      }
    });

  } catch (error) {
    console.error("❌ Error in admin signup:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create admin account",
      error: error.message
    });
  }
});

// POST /api/admin/admin-login - Admin login with password verification
router.post("/admin-login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required"
      });
    }

    // Check if user exists in dashboard_users table
    const userQuery = `SELECT * FROM dashboard_users WHERE email = ? ALLOW FILTERING`;
    const userResult = await client.execute(userQuery, [email], { prepare: true });

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Account not found. Please sign up first.",
        exists: false
      });
    }

    const user = userResult.rows[0];

    // Check if user has dashboard access (admin, superadmin, or moderator)
    if (user.role !== 'admin' && user.role !== 'superadmin' && user.role !== 'moderator') {
      return res.status(403).json({
        success: false,
        message: "Access denied. Admin or moderator role required."
      });
    }

    // Check if user is active
    if (user.status !== 'active') {
      return res.status(403).json({
        success: false,
        message: "Account is not active"
      });
    }

    // Get password hash from MongoDB
    const passwordRecord = await AdminPassword.findOne({ email });

    if (!passwordRecord) {
      // Fallback to environment variable password for existing admins
      const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
      if (password !== adminPassword) {
        return res.status(401).json({
          success: false,
          message: "Invalid password"
        });
      }
    } else {
      // Verify password with bcrypt
      const passwordMatch = await bcrypt.compare(password, passwordRecord.passwordHash);

      if (!passwordMatch) {
        return res.status(401).json({
          success: false,
          message: "Invalid password"
        });
      }
    }

    // Generate JWT token
    const token = jwt.sign({
      email: user.email,
      role: user.role,
      name: user.name
    }, process.env.JWT_SECRET_KEY, { expiresIn: '7d' });

    res.json({
      success: true,
      message: "Admin login successful",
      token,
      user: {
        email: user.email,
        name: user.name,
        role: user.role
      }
    });

  } catch (error) {
    console.error("❌ Error in admin login:", error);
    res.status(500).json({
      success: false,
      message: "Failed to login",
      error: error.message
    });
  }
});

// POST /api/auth/admin-login - Admin login
router.post("/auth/admin-login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        message: "Email and password are required" 
      });
    }

    // Find admin user
    const query = `SELECT * FROM users WHERE email = ? AND (role = 'admin' OR role = 'superadmin') ALLOW FILTERING`;
    const result = await client.execute(query, [email], { prepare: true });

    if (result.rows.length === 0) {
      return res.status(401).json({ 
        success: false, 
        message: "Invalid email or password" 
      });
    }

    const user = result.rows[0];

    // Check if user is active
    if (user.status !== 'active') {
      return res.status(403).json({ 
        success: false, 
        message: "Account is not active" 
      });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      return res.status(401).json({ 
        success: false, 
        message: "Invalid email or password" 
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    console.log("✅ Admin login successful:", email);

    res.json({ 
      success: true, 
      message: "Login successful",
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        profileImage: user.profileimage
      }
    });

  } catch (error) {
    console.error("❌ Error in admin login:", error);
    res.status(500).json({ 
      success: false, 
      message: "Login failed",
      error: error.message 
    });
  }
});

// GET /api/admin/dashboard-data - Get all users for admin dashboard
router.get("/dashboard-data", verifyToken, async (req, res) => {
    try {
        const adminEmail = req.user.email;
        const adminRole = req.user.role;

        if (adminRole !== 'admin' && adminRole !== 'superadmin' && adminRole !== 'moderator') {
            return res.status(403).json({
                success: false,
                message: "Access denied"
            });
        }

        const query = "SELECT id, email, name, role, status FROM users";
        const result = await client.execute(query, { prepare: true });

        const users = result.rows.map(row => ({
            id: row.id.toString(),
            email: row.email,
            name: row.name,
            role: row.role,
            status: row.status
        }));

        res.json({
            success: true,
            data: { users }
        });

    } catch (error) {
        console.error("❌ Error fetching dashboard data:", error);
        res.status(500).json({
            success: false,
            message: "Failed to fetch dashboard data",
            error: error.message
        });
    }
});

// POST /api/admin/send-notification - Admin sends notification to ALL, ALL_TEACHERS, ALL_STUDENTS, or specific email
router.post("/send-notification", verifyToken, async (req, res) => {
    try {
        const adminEmail = req.user.email;
        const adminRole = req.user.role;
        const { message, target_user_email } = req.body;

        if (!message || !message.trim()) {
            return res.status(400).json({
                success: false,
                message: "Message is required"
            });
        }

        if (!target_user_email) {
            return res.status(400).json({
                success: false,
                message: "target_user_email is required",
                valid_targets: ["ALL", "ALL_TEACHERS", "ALL_STUDENTS", "specific@email.com"]
            });
        }

        if (adminRole !== 'admin' && adminRole !== 'superadmin' && adminRole !== 'moderator') {
            return res.status(403).json({
                success: false,
                message: "Only admins can send notifications"
            });
        }

        let targetType = 'individual';
        if (['ALL', 'ALL_TEACHERS', 'ALL_STUDENTS'].includes(target_user_email)) {
            targetType = 'broadcast';
        }

        const query = `
            INSERT INTO notifications (id, sender_name, avatar_url, message, created_at, target_user_email, target_type)
            VALUES (uuid(), ?, ?, ?, toTimestamp(now()), ?, ?)
        `;

        await client.execute(query, [
            adminEmail,
            'https://cdn-icons-png.flaticon.com/512/3135/3135715.png',
            message.trim(),
            target_user_email,
            targetType
        ], { prepare: true });

        console.log(`✅ Admin notification sent by ${adminEmail} to ${target_user_email} (${targetType})`);

        res.json({
            success: true,
            message: "Notification sent successfully",
            target_user_email: target_user_email,
            target_type: targetType
        });

    } catch (error) {
        console.error("❌ Error sending notification:", error);
        res.status(500).json({
            success: false,
            message: "Failed to send notification",
            error: error.message
        });
    }
});

// GET /api/admin/all-subjects - Get all subjects regardless of teacher_email (admin only)
router.get("/all-subjects", verifyToken, checkAdminRole, async (req, res) => {
  try {
    const query = "SELECT * FROM subjects";
    const result = await client.execute(query, { prepare: true });

    const teacherEmails = [...new Set(result.rows.map((r) => r.teacher_email).filter(Boolean))];
    const teacherNamesMap = {};

    if (teacherEmails.length > 0) {
      try {
        const placeholders = teacherEmails.map(() => "?").join(",");
        const teacherQuery = `SELECT email, name FROM teachers1 WHERE email IN (${placeholders}) ALLOW FILTERING`;
        const teacherResult = await client.execute(teacherQuery, teacherEmails, { prepare: true });
        teacherResult.rows.forEach((r) => {
          teacherNamesMap[r.email] = r.name;
        });
      } catch (err) {
        console.error("Error fetching teacher names from teachers1:", err.message);
      }

      const missingEmails = teacherEmails.filter((e) => !teacherNamesMap[e]);
      if (missingEmails.length > 0) {
        try {
          const placeholders2 = missingEmails.map(() => "?").join(",");
          const userQuery = `SELECT email, name FROM dashboard_users WHERE email IN (${placeholders2}) ALLOW FILTERING`;
          const userResult = await client.execute(userQuery, missingEmails, { prepare: true });
          userResult.rows.forEach((r) => {
            teacherNamesMap[r.email] = r.name;
          });
        } catch (err) {
          console.error("Error fetching teacher names from dashboard_users:", err.message);
        }
      }
    }

    const subjects = result.rows.map((row) => ({
      subject_id: row.subject_id?.toString(),
      board: row.board || "",
      class_category: row.class_category || "",
      class_name: row.class_name || "",
      created_at: row.created_at?.toISOString(),
      description: row.description || "",
      status: row.status || "pending",
      subject_title: row.subject_title || "",
      teacher_email: row.teacher_email || "",
      teaching_category: row.teaching_category || "",
      teacher_name: teacherNamesMap[row.teacher_email] || row.teacher_email?.split("@")[0] || "Unknown",
    }));

    res.json({
      success: true,
      subjects,
      total: subjects.length,
    });
  } catch (error) {
    console.error("Error fetching all subjects:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch subjects",
      error: error.message,
    });
  }
});

// GET /api/admin/published-subjects - Get all published subjects for admin review (admin only)
router.get("/published-subjects", verifyToken, checkAdminRole, async (req, res) => {
  try {
    const query = "SELECT * FROM subjects";
    const result = await client.execute(query, { prepare: true });

    const teacherEmails = [...new Set(result.rows.map((r) => r.teacher_email).filter(Boolean))];
    const teacherNamesMap = {};

    if (teacherEmails.length > 0) {
      try {
        const placeholders = teacherEmails.map(() => "?").join(",");
        const teacherQuery = `SELECT email, name FROM teachers1 WHERE email IN (${placeholders}) ALLOW FILTERING`;
        const teacherResult = await client.execute(teacherQuery, teacherEmails, { prepare: true });
        teacherResult.rows.forEach((r) => {
          teacherNamesMap[r.email] = r.name;
        });
      } catch (err) {
        console.error("Error fetching teacher names from teachers1:", err.message);
      }

      const missingEmails = teacherEmails.filter((e) => !teacherNamesMap[e]);
      if (missingEmails.length > 0) {
        try {
          const placeholders2 = missingEmails.map(() => "?").join(",");
          const userQuery = `SELECT email, name FROM dashboard_users WHERE email IN (${placeholders2}) ALLOW FILTERING`;
          const userResult = await client.execute(userQuery, missingEmails, { prepare: true });
          userResult.rows.forEach((r) => {
            teacherNamesMap[r.email] = r.name;
          });
        } catch (err) {
          console.error("Error fetching teacher names from dashboard_users:", err.message);
        }
      }
    }

    const subjects = result.rows.map((row) => ({
      subject_id: row.subject_id?.toString(),
      board: row.board || "",
      class_category: row.class_category || "",
      class_name: row.class_name || "",
      created_at: row.created_at?.toISOString(),
      description: row.description || "",
      status: row.status || "pending",
      subject_title: row.subject_title || "",
      teacher_email: row.teacher_email || "",
      teaching_category: row.teaching_category || "",
      teacher_name: teacherNamesMap[row.teacher_email] || row.teacher_email?.split("@")[0] || "Unknown",
    }));

    res.json({
      success: true,
      subjects,
      total: subjects.length,
    });
  } catch (error) {
    console.error("Error fetching published subjects:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch subjects",
      error: error.message,
    });
  }
});

// POST /api/admin/update-subject-status - Update subject status to accepted or rejected (admin only)
router.post("/update-subject-status", verifyToken, checkAdminRole, async (req, res) => {
  try {
    const { subject_id, status } = req.body;

    if (!subject_id) {
      return res.status(400).json({
        success: false,
        message: "subject_id is required",
      });
    }

    if (!status || !["accepted", "rejected"].includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Status must be either 'accepted' or 'rejected'",
      });
    }

    const updateQuery =
      "UPDATE subjects SET status = ? WHERE subject_id = ?";
    await client.execute(
      updateQuery,
      [status, subject_id],
      { prepare: true }
    );

    console.log(`✅ Subject ${subject_id} status updated to: ${status}`);

    res.json({
      success: true,
      message: `Subject status updated to ${status}`,
      subject_id,
      status,
    });
  } catch (error) {
    console.error("Error updating subject status:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to update subject status",
      error: error.message,
    });
  }
});

module.exports = router;