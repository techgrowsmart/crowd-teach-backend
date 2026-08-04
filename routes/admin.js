const express = require("express");
const router = express.Router();
const client = require("../config/db");
const verifyToken = require("../utils/verifyToken");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const multer = require("multer");
const path = require("path");
const { s3 } = require("../config/s3");
const multerS3 = require("multer-s3");

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
    if (user.status.toLowerCase() !== 'active') {
      return res.status(403).json({
        success: false,
        message: "Account on hold",
        accountStatus: "inactive",
        onHoldMessage: "due to some violations your account is on hold Try contacting admin of growsmart"
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
    if (user.status.toLowerCase() !== 'active') {
      return res.status(403).json({ 
        success: false, 
        message: "Account on hold",
        accountStatus: "inactive",
        onHoldMessage: "due to some violations your account is on hold Try contacting admin of growsmart"
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

        const query = "SELECT id, email, name, role, status, profileimage FROM users";
        const result = await client.execute(query, { prepare: true });

        const users = result.rows.map(row => ({
            id: row.id.toString(),
            email: row.email,
            name: row.name,
            role: row.role,
            status: row.status,
            profileimage: row.profileimage || null
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
    const teacherProfileMap = {};

    if (teacherEmails.length > 0) {
      try {
        const placeholders = teacherEmails.map(() => "?").join(",");
        const teacherQuery = `SELECT email, name, profilepic FROM teachers1 WHERE email IN (${placeholders}) ALLOW FILTERING`;
        const teacherResult = await client.execute(teacherQuery, teacherEmails, { prepare: true });
        teacherResult.rows.forEach((r) => {
          teacherNamesMap[r.email] = r.name;
          teacherProfileMap[r.email] = r.profilepic;
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
      teacher_profilepic: teacherProfileMap[row.teacher_email] || null
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
    const teacherProfileMap = {};

    if (teacherEmails.length > 0) {
      try {
        const placeholders = teacherEmails.map(() => "?").join(",");
        const teacherQuery = `SELECT email, name, profilepic FROM teachers1 WHERE email IN (${placeholders}) ALLOW FILTERING`;
        const teacherResult = await client.execute(teacherQuery, teacherEmails, { prepare: true });
        teacherResult.rows.forEach((r) => {
          teacherNamesMap[r.email] = r.name;
          teacherProfileMap[r.email] = r.profilepic;
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
      teacher_profilepic: teacherProfileMap[row.teacher_email] || null
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

// DELETE /api/admin/users/:id - Remove a user from the database (admin only)
router.delete("/users/:id", verifyToken, checkAdminRole, async (req, res) => {
  try {
    const { id } = req.params;

    const query = "DELETE FROM users WHERE id = ?";
    await client.execute(query, [id], { prepare: true });

    console.log(`✅ User ${id} deleted successfully`);

    res.json({
      success: true,
      message: "User deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting user:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to delete user",
      error: error.message,
    });
  }
});

// PATCH /api/admin/users/:id/block - Block or unblock a user (toggle status between inactive/active)
router.patch("/users/:id/block", verifyToken, checkAdminRole, async (req, res) => {
  try {
    const { id } = req.params;

    const getQuery = "SELECT status FROM users WHERE id = ?";
    const getResult = await client.execute(getQuery, [id], { prepare: true });

    if (getResult.rowLength === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const currentStatus = getResult.rows[0].status;
    const newStatus = currentStatus === 'inactive' ? 'active' : 'inactive';

    const updateQuery = "UPDATE users SET status = ? WHERE id = ?";
    await client.execute(updateQuery, [newStatus, id], { prepare: true });

    console.log(`✅ User ${id} status updated: ${currentStatus} -> ${newStatus}`);

    res.json({
      success: true,
      message: `User status updated to ${newStatus}`,
      userId: id,
      status: newStatus,
    });
  } catch (error) {
    console.error("Error updating user status:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to update user status",
      error: error.message,
    });
  }
});

// =============================================================================
// Advertisement Management (S3 image upload + MongoDB storage)

// MongoDB schema for advertisements
const AdSchema = new mongoose.Schema({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  cta: { type: String, default: 'Learn More' },
  tag: { type: String, default: 'ADVERTISEMENT' },
  imageUrl: { type: String, default: null },
  gradient: { type: [String], default: ['#4F46E5', '#7C3AED'] },
  accent: { type: String, default: '#A78BFA' },
  icon: { type: String, default: 'school-outline' },
  targetRole: { type: String, enum: ['teacher', 'student'], default: 'student' },
  section: { type: String, enum: ['section1', 'section2'], default: 'section1' },
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { collection: 'ads' });

const Ad = mongoose.models.Ad || mongoose.model('Ad', AdSchema);

// Multer-S3 upload for ad banner images
const adImageUpload = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.S3_BUCKET_NAME,
    metadata: (req, file, cb) => {
      cb(null, { fieldName: file.fieldname });
    },
    key: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, `ad-images/${Date.now()}-${file.originalname}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and WebP images are allowed'), false);
    }
  }
});

// POST /api/admin/ads - Create a new advertisement with S3 image upload (admin only)
router.post('/ads', verifyToken, checkAdminRole, adImageUpload.single('image'), async (req, res) => {
  try {
    const { title, subtitle, cta, tag, gradient, accent, icon, targetRole, section } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Title is required'
      });
    }

    let imageUrl = null;
    if (req.file) {
      imageUrl = req.file.location;
    }

    let parsedGradient = ['#4F46E5', '#7C3AED'];
    if (gradient) {
      try {
        parsedGradient = typeof gradient === 'string' ? JSON.parse(gradient) : gradient;
      } catch (e) {
        parsedGradient = gradient.split(',');
      }
    }

    let parsedTargetRole = 'student';
    if (targetRole && ['teacher', 'student'].includes(targetRole)) {
      parsedTargetRole = targetRole;
    }

    let parsedSection = 'section1';
    if (section && ['section1', 'section2'].includes(section)) {
      parsedSection = section;
    }

    // Teacher role only has a single section (section1). Enforce that here.
    if (parsedTargetRole === 'teacher') {
      parsedSection = 'section1';
    }

    const newAd = new Ad({
      title: title.trim(),
      subtitle: subtitle || '',
      cta: cta || 'Learn More',
      tag: tag || 'ADVERTISEMENT',
      imageUrl,
      gradient: parsedGradient,
      accent: accent || '#A78BFA',
      icon: icon || 'school-outline',
      targetRole: parsedTargetRole,
      section: parsedSection,
      isActive: true
    });

    await newAd.save();

    console.log(`✅ Ad created: ${newAd._id}`);

    res.status(201).json({
      success: true,
      message: 'Advertisement created successfully',
      ad: {
        id: newAd._id.toString(),
        title: newAd.title,
        subtitle: newAd.subtitle,
        cta: newAd.cta,
        tag: newAd.tag,
        imageUrl: newAd.imageUrl,
        gradient: newAd.gradient,
        accent: newAd.accent,
        icon: newAd.icon,
        targetRole: newAd.targetRole,
        section: newAd.section,
        isActive: newAd.isActive,
        createdAt: newAd.createdAt
      }
    });
  } catch (error) {
    console.error('❌ Error creating ad:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create advertisement',
      error: error.message
    });
  }
});

// GET /api/admin/ads - Public endpoint to get all active ads (used by AdvertisementBanner)
// Supports optional query params: ?targetRole=teacher|student&section=section1|section2
// Legacy ads (missing targetRole/section) are returned for any request to preserve visibility.
router.get('/ads', async (req, res) => {
  try {
    const { targetRole, section } = req.query;

    const conditions = [];
    if (targetRole) {
      conditions.push({
        $or: [
          { targetRole: { $exists: false } },
          { targetRole: targetRole },
          { targetRole: 'both' }
        ]
      });
    }
    if (section) {
      conditions.push({
        $or: [
          { section: { $exists: false } },
          { section: section }
        ]
      });
    }

    const filter = { isActive: true };
    if (conditions.length) {
      filter.$and = conditions;
    }

    const ads = await Ad.find(filter)
      .sort({ createdAt: -1 })
      .lean();

    const formattedAds = ads.map(ad => ({
      id: ad._id.toString(),
      imageUrl: ad.imageUrl || null,
      tag: ad.tag || 'ADVERTISEMENT',
      title: ad.title || '',
      subtitle: ad.subtitle || '',
      cta: ad.cta || 'Learn More',
      gradient: ad.gradient || ['#4F46E5', '#7C3AED'],
      accent: ad.accent || '#A78BFA',
      icon: ad.icon || 'school-outline',
      targetRole: ad.targetRole || 'student',
      section: ad.section || 'section1'
    }));

    res.json(formattedAds);
  } catch (error) {
    console.error('❌ Error fetching ads:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch advertisements',
      error: error.message
    });
  }
});

// GET /api/admin/ads/all - Get all ads for admin management (admin only)
router.get('/ads/all', verifyToken, checkAdminRole, async (req, res) => {
  try {
    const ads = await Ad.find({})
      .sort({ createdAt: -1 })
      .lean();

    const formattedAds = ads.map(ad => ({
      id: ad._id.toString(),
      title: ad.title,
      subtitle: ad.subtitle,
      cta: ad.cta,
      tag: ad.tag,
      imageUrl: ad.imageUrl,
      gradient: ad.gradient,
      accent: ad.accent,
      icon: ad.icon,
      targetRole: ad.targetRole || 'student',
      section: ad.section || 'section1',
      isActive: ad.isActive,
      createdAt: ad.createdAt,
      updatedAt: ad.updatedAt
    }));

    res.json({
      success: true,
      ads: formattedAds
    });
  } catch (error) {
    console.error('❌ Error fetching all ads:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch advertisements',
      error: error.message
    });
  }
});

// PUT /api/admin/ads/:id - Update an advertisement (admin only)
router.put('/ads/:id', verifyToken, checkAdminRole, adImageUpload.single('image'), async (req, res) => {
  try {
    const { id } = req.params;
    const { title, subtitle, cta, tag, gradient, accent, icon, targetRole, section, isActive } = req.body;

    const updateData = {};
    if (title !== undefined) updateData.title = title.trim();
    if (subtitle !== undefined) updateData.subtitle = subtitle;
    if (cta !== undefined) updateData.cta = cta;
    if (tag !== undefined) updateData.tag = tag;
    if (gradient !== undefined) {
      try {
        updateData.gradient = typeof gradient === 'string' ? JSON.parse(gradient) : gradient;
      } catch (e) {
        updateData.gradient = gradient.split(',');
      }
    }
    if (accent !== undefined) updateData.accent = accent;
    if (icon !== undefined) updateData.icon = icon;
    if (targetRole !== undefined && ['teacher', 'student'].includes(targetRole)) {
      updateData.targetRole = targetRole;
    }
    if (section !== undefined && ['section1', 'section2'].includes(section)) {
      updateData.section = section;
    }
    if (isActive !== undefined) updateData.isActive = isActive === 'true' || isActive === true;

    if (req.file) {
      updateData.imageUrl = req.file.location;
    }

    updateData.updatedAt = new Date();

    // Teacher role only has a single section (section1). Enforce that here,
    // considering both an explicitly updated role and the existing doc's role.
    let effectiveRole = updateData.targetRole;
    if (!effectiveRole) {
      const existingAd = await Ad.findById(id).lean();
      if (existingAd) {
        effectiveRole = existingAd.targetRole;
      }
    }
    if (effectiveRole === 'teacher') {
      updateData.section = 'section1';
    }

    const updatedAd = await Ad.findOneAndUpdate(
      { _id: id },
      updateData,
      { new: true, runValidators: true }
    ).lean();

    if (!updatedAd) {
      return res.status(404).json({
        success: false,
        message: 'Advertisement not found'
      });
    }

    res.json({
      success: true,
      message: 'Advertisement updated successfully',
      ad: {
        id: updatedAd._id.toString(),
        title: updatedAd.title,
        subtitle: updatedAd.subtitle,
        cta: updatedAd.cta,
        tag: updatedAd.tag,
        imageUrl: updatedAd.imageUrl,
        gradient: updatedAd.gradient,
        accent: updatedAd.accent,
        icon: updatedAd.icon,
        targetRole: updatedAd.targetRole,
        section: updatedAd.section,
        isActive: updatedAd.isActive,
        createdAt: updatedAd.createdAt,
        updatedAt: updatedAd.updatedAt
      }
    });
  } catch (error) {
    console.error('❌ Error updating ad:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update advertisement',
      error: error.message
    });
  }
});

// DELETE /api/admin/ads/:id - Delete an advertisement (admin only)
router.delete('/ads/:id', verifyToken, checkAdminRole, async (req, res) => {
  try {
    const { id } = req.params;

    const deletedAd = await Ad.findByIdAndDelete(id);

    if (!deletedAd) {
      return res.status(404).json({
        success: false,
        message: 'Advertisement not found'
      });
    }

    console.log(`✅ Ad deleted: ${id}`);

    res.json({
      success: true,
      message: 'Advertisement deleted successfully'
    });
  } catch (error) {
    console.error('❌ Error deleting ad:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete advertisement',
      error: error.message
    });
  }
});

module.exports = router;