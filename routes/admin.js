const express = require("express");
const router = express.Router();
const client = require("../config/db");
const verifyToken = require("../utils/verifyToken");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const mongoose = require('mongoose');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

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

// GET /api/admin/profile - Get admin profile
router.get("/profile", verifyToken, async (req, res) => {
  try {
    const userEmail = req.user.email;

    const query = `SELECT id, email, name, phonenumber, role, status, created_at, department, location, actions
                   FROM dashboard_users WHERE email = ? ALLOW FILTERING`;
    const result = await client.execute(query, [userEmail], { prepare: true });

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Admin profile not found"
      });
    }

    const user = result.rows[0];

    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phonenumber,
        role: user.role,
        status: user.status,
        createdAt: user.created_at,
        department: user.department,
        location: user.location,
        actions: user.actions || []
      }
    });

  } catch (error) {
    console.error("❌ Error fetching admin profile:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch profile",
      error: error.message
    });
  }
});

// POST /api/admin/profile - Create or update admin profile
router.post("/profile", verifyToken, async (req, res) => {
  try {
    const userEmail = req.user.email;
    const { name, phone, role, department, location } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Name is required"
      });
    }

    // First, get the user's id by email
    const getUserQuery = `SELECT id FROM dashboard_users WHERE email = ? ALLOW FILTERING`;
    const userResult = await client.execute(getUserQuery, [userEmail], { prepare: true });

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const userId = userResult.rows[0].id;

    // Update user profile using id
    const updateQuery = `UPDATE dashboard_users SET name = ?, phonenumber = ?, role = ?, department = ?, location = ?
                         WHERE id = ?`;
    await client.execute(updateQuery, [name, phone || null, role || 'admin', department || null, location || null, userId], { prepare: true });

    // Fetch updated profile
    const query = `SELECT id, email, name, phonenumber, role, status, created_at, department, location, actions
                   FROM dashboard_users WHERE id = ?`;
    const result = await client.execute(query, [userId], { prepare: true });

    console.log("✅ Admin profile updated:", userEmail);

    res.json({
      success: true,
      message: "Profile updated successfully",
      data: {
        id: result.rows[0].id,
        email: result.rows[0].email,
        name: result.rows[0].name,
        phone: result.rows[0].phonenumber,
        role: result.rows[0].role,
        status: result.rows[0].status,
        createdAt: result.rows[0].created_at,
        department: result.rows[0].department,
        location: result.rows[0].location,
        actions: result.rows[0].actions || []
      }
    });

  } catch (error) {
    console.error("❌ Error updating admin profile:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update profile",
      error: error.message
    });
  }
});

// POST /api/admin/track-action - Track user action
router.post("/track-action", verifyToken, async (req, res) => {
  try {
    const userEmail = req.user.email;
    const { action, targetEmail, targetName } = req.body;

    if (!action) {
      return res.status(400).json({
        success: false,
        message: "Action type is required"
      });
    }

    // Valid action types
    const validActions = ['reject', 'accept', 'resubmit', 'approve', 'deny', 'suspend', 'activate'];
    if (!validActions.includes(action)) {
      return res.status(400).json({
        success: false,
        message: "Invalid action type"
      });
    }

    // Get user's current actions
    const getUserQuery = `SELECT id, actions FROM dashboard_users WHERE email = ? ALLOW FILTERING`;
    const userResult = await client.execute(getUserQuery, [userEmail], { prepare: true });

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    const userId = userResult.rows[0].id;
    const currentActions = userResult.rows[0].actions || [];

    // Create action record with timestamp
    const actionRecord = {
      type: action,
      targetEmail: targetEmail || null,
      targetName: targetName || null,
      timestamp: new Date().toISOString()
    };

    // Add new action to the list
    const updatedActions = [...currentActions, JSON.stringify(actionRecord)];

    // Update user's actions
    const updateQuery = `UPDATE dashboard_users SET actions = ? WHERE id = ?`;
    await client.execute(updateQuery, [updatedActions, userId], { prepare: true });

    console.log(`✅ Action tracked: ${userEmail} performed ${action} on ${targetEmail || 'N/A'}`);

    res.json({
      success: true,
      message: "Action tracked successfully",
      action: actionRecord
    });

  } catch (error) {
    console.error("❌ Error tracking action:", error);
    res.status(500).json({
      success: false,
      message: "Failed to track action",
      error: error.message
    });
  }
});

// GET /api/admin/dashboard-data - Get all data for admin dashboard
// This single endpoint fetches all necessary data for admin controls
router.get("/dashboard-data", verifyToken, async (req, res) => {
  try {
    // Verify admin role (optional - remove if not needed)
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({ 
        success: false, 
        message: "Access denied. Admin role required." 
      });
    }

    console.log("📊 Fetching admin dashboard data...");

    // Fetch all tutors from tutors table
    const tutorsQuery = `SELECT id, email, full_name, phone_number, aadhar_front, aadhar_back, certification, 
                                  heighest_qualification_certification, pan, selfie_with_aadhar_back, selfie_with_aadhar_front, iscertified
                         FROM tutors ALLOW FILTERING`;
    const tutorsResult = await client.execute(tutorsQuery, [], { prepare: true });

    console.log("📊 Tutors query result sample:", tutorsResult.rows.length > 0 ? {
      email: tutorsResult.rows[0].email,
      aadhar_front: tutorsResult.rows[0].aadhar_front ? "✅ has URL" : "❌ null",
      pan: tutorsResult.rows[0].pan ? "✅ has URL" : "❌ null",
      selfie_with_aadhar_front: tutorsResult.rows[0].selfie_with_aadhar_front ? "✅ has URL" : "❌ null"
    } : "No tutors found");

    // Fetch all teachers from teachers1 table (might have documents)
    const teachers1Query = `SELECT email, name, category, introduction, isspotlight, profilepic, subscription_expiry,
                                  qualifications, teachingmode, tuitions, workexperience, university
                           FROM teachers1`;
    const teachers1Result = await client.execute(teachers1Query, [], { prepare: true });

    // Fetch all users from users table
    const usersQuery = `SELECT id, email, name, phonenumber, role, profileImage, status, created_at, referral_code, referral_count
                        FROM users ALLOW FILTERING`;
    const usersResult = await client.execute(usersQuery, [], { prepare: true });

    // Fetch all bank details (DPDP 2023 Compliant - no sensitive bank data)
    const bankDetailsQuery = `SELECT user_id, email, upi_id, qr_code_url, pincode, location_address, location_lat, location_lng
                              FROM bank_details ALLOW FILTERING`;
    const bankDetailsResult = await client.execute(bankDetailsQuery, [], { prepare: true });

    // Organize data by role for easier dashboard consumption
    const teachers = usersResult.rows.filter(user => user.role === 'teacher');
    const studentsUsers = usersResult.rows.filter(user => user.role === 'student');
    const admins = usersResult.rows.filter(user => user.role === 'admin' || user.role === 'superadmin');

    // Combine tutor data from multiple sources
    const enrichedTutors = tutorsResult.rows.map(tutor => {
      const teacher1Data = teachers1Result.rows.find(t => t.email === tutor.email);
      const userData = usersResult.rows.find(u => u.email === tutor.email);
      const bankDetails = bankDetailsResult.rows.find(b => b.email === tutor.email);

      // Use status from users table if available, otherwise default to pending
      const status = userData?.status || 'pending';

      // Handle documents - certification and heighest_qualification_certification might be arrays
      // Also check teachers1 table for documents if tutors table doesn't have them
      const documents = {
        aadhar_front: tutor.aadhar_front || teacher1Data?.profilepic || null,
        aadhar_back: tutor.aadhar_back || null,
        certification: Array.isArray(tutor.certification) ? tutor.certification : tutor.certification || teacher1Data?.qualifications || null,
        heighest_qualification_certification: Array.isArray(tutor.heighest_qualification_certification) ? tutor.heighest_qualification_certification : tutor.heighest_qualification_certification || null,
        pan: tutor.pan || null,
        selfie_with_aadhar_back: tutor.selfie_with_aadhar_back || null,
        selfie_with_aadhar_front: tutor.selfie_with_aadhar_front || teacher1Data?.profilepic || null
      };

      console.log(`Tutor: ${tutor.email}, User data found: ${!!userData}, Status: ${status}, Docs: ${Object.values(documents).filter(v => v).length} present, Bank details: ${!!bankDetails}, Spotlight: ${teacher1Data?.isspotlight}`);

      return {
        ...tutor,
        teachers1_data: teacher1Data || null,
        user_data: userData || null,
        bank_details: bankDetails || null,
        status: status,
        documents: documents,
        isspotlight: teacher1Data?.isspotlight || false,
        subscription_expiry: teacher1Data?.subscription_expiry || null
      };
    });

    // Combine teacher data from multiple sources
    const enrichedTeachers = teachers.map(teacher => {
      const teacher1Data = teachers1Result.rows.find(t => t.email === teacher.email);

      return {
        ...teacher,
        teachers1_data: teacher1Data || null,
        status: teacher.status || 'pending' // Default to pending if not set
      };
    });

    const dashboardData = {
      success: true,
      timestamp: new Date().toISOString(),
      data: {
        tutors: enrichedTutors,
        teachers: enrichedTeachers,
        students: studentsUsers,
        users: usersResult.rows,
        statistics: {
          total_tutors: enrichedTutors.length,
          total_teachers: enrichedTeachers.length,
          total_students: studentsUsers.length,
          total_admins: admins.length,
          total_users: usersResult.rowLength,
          pending_tutors: enrichedTutors.filter(t => t.status === 'pending').length,
          active_tutors: enrichedTutors.filter(t => t.status === 'active').length,
          pending_teachers: enrichedTeachers.filter(t => t.status === 'pending').length,
          active_teachers: enrichedTeachers.filter(t => t.status === 'active').length,
          dormant_teachers: enrichedTeachers.filter(t => t.status === 'dormant').length,
          banned_teachers: enrichedTeachers.filter(t => t.status === 'banned').length,
        }
      }
    };

    console.log("✅ Admin dashboard data fetched successfully");
    console.log("📊 Statistics:", dashboardData.data.statistics);

    res.json(dashboardData);

  } catch (error) {
    console.error("❌ Error fetching admin dashboard data:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to fetch dashboard data",
      error: error.message 
    });
  }
});

// GET /api/admin/teachers/:email - Get detailed info for a specific teacher
router.get("/teachers/:email", verifyToken, async (req, res) => {
  try {
    const { email } = req.params;

    // Fetch from all teacher-related tables
    const userQuery = `SELECT * FROM users WHERE email = ? ALLOW FILTERING`;
    const userResult = await client.execute(userQuery, [email], { prepare: true });

    const teachers1Query = `SELECT * FROM teachers1 WHERE email = ?`;
    const teachers1Result = await client.execute(teachers1Query, [email], { prepare: true });

    const tutorsQuery = `SELECT * FROM tutors WHERE email = ? ALLOW FILTERING`;
    const tutorsResult = await client.execute(tutorsQuery, [email], { prepare: true });

    const subjectsQuery = `SELECT * FROM subjects WHERE teacher_email = ? ALLOW FILTERING`;
    const subjectsResult = await client.execute(subjectsQuery, [email], { prepare: true });

    const teacherData = {
      user: userResult.rows[0] || null,
      teachers1: teachers1Result.rows[0] || null,
      tutor: tutorsResult.rows[0] || null,
      subjects: subjectsResult.rows || []
    };

    res.json({ success: true, data: teacherData });

  } catch (error) {
    console.error("❌ Error fetching teacher details:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Helper function to ensure notification_admin table exists
const ensureNotificationAdminTable = async () => {
  try {
    const tableExists = await client.execute(
      "SELECT table_name FROM system_schema.tables WHERE keyspace_name = ? AND table_name = ?",
      [process.env.ASTRA_DB_KEYSPACE || 'gogrowsmart', 'notification_admin'],
      { prepare: true }
    );

    if (tableExists.rowLength === 0) {
      console.log('🔄 Creating notification_admin table...');
      await client.execute(`
        CREATE TABLE notification_admin (
          id uuid PRIMARY KEY,
          message text,
          created_at timestamp,
          target_email text,
          target_role text,
          target_all boolean
        ) WITH CLUSTERING ORDER BY (created_at DESC)
        AND additional_write_policy = '99p'
      `);
      console.log('✅ Created notification_admin table');
    } else {
      console.log('✅ notification_admin table exists');
    }
    return true;
  } catch (error) {
    console.error('❌ Error ensuring notification_admin table:', error);
    return false;
  }
};

// Helper function to ensure notification_admin_read_status table exists
const ensureNotificationAdminReadStatusTable = async () => {
  try {
    const tableExists = await client.execute(
      "SELECT table_name FROM system_schema.tables WHERE keyspace_name = ? AND table_name = ?",
      [process.env.ASTRA_DB_KEYSPACE || 'gogrowsmart', 'notification_admin_read_status'],
      { prepare: true }
    );

    if (tableExists.rowLength === 0) {
      console.log('🔄 Creating notification_admin_read_status table...');
      await client.execute(`
        CREATE TABLE notification_admin_read_status (
          user_email text,
          notification_id uuid,
          is_read boolean,
          read_at timestamp,
          PRIMARY KEY (user_email, notification_id)
        )
      `);
      console.log('✅ Created notification_admin_read_status table');
    } else {
      console.log('✅ notification_admin_read_status table exists');
    }
    return true;
  } catch (error) {
    console.error('❌ Error ensuring notification_admin_read_status table:', error);
    return false;
  }
};

// POST /api/admin/send-notification - Send notification with targeting
router.post("/send-notification", verifyToken, async (req, res) => {
  try {
    const { message, target_user_email } = req.body;

    // Verify admin role
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin' && req.user.role !== 'moderator') {
      return res.status(403).json({
        success: false,
        message: "Access denied. Admin role required."
      });
    }

    if (!message) {
      return res.status(400).json({
        success: false,
        message: "Message is required"
      });
    }

    if (!target_user_email) {
      return res.status(400).json({
        success: false,
        message: "target_user_email is required",
        valid_targets: ['specific@email.com', 'ALL', 'ALL_TEACHERS', 'ALL_STUDENTS']
      });
    }

    // Determine target_type based on target_user_email
    let targetType = 'individual';
    if (['ALL', 'ALL_TEACHERS', 'ALL_STUDENTS'].includes(target_user_email)) {
      targetType = 'broadcast';
    }

    // Ensure table exists
    await ensureNotificationAdminTable();

    // Insert notification with new targeting
    const query = `
      INSERT INTO notification_admin (id, message, created_at, target_user_email, target_type)
      VALUES (uuid(), ?, toTimestamp(now()), ?, ?)
    `;

    await client.execute(
      query,
      [
        message,
        target_user_email,
        targetType
      ],
      { prepare: true }
    );

    console.log(`✅ Notification sent successfully - target_user_email: ${target_user_email} (${targetType})`);
    res.json({
      success: true,
      message: "Notification sent successfully",
      target_user_email,
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

// GET /api/admin/notifications - Get admin notifications
router.get("/notifications", verifyToken, async (req, res) => {
  try {
    const userEmail = req.user.email;
    const userRole = req.user.role;

    // Ensure tables exist
    await ensureNotificationAdminTable();
    await ensureNotificationAdminReadStatusTable();

    // Fetch all notifications
    const notificationsQuery = `SELECT id, message, created_at, target_email, target_role, target_all FROM notification_admin LIMIT 50`;
    const notificationsResult = await client.execute(notificationsQuery, [], { prepare: true });

    // Filter notifications based on targeting
    const filteredNotifications = notificationsResult.rows.filter(notification => {
      // If target_all is true, show to everyone
      if (notification.target_all) return true;
      
      // If target_email matches user's email, show
      if (notification.target_email && notification.target_email === userEmail) return true;
      
      // If target_role matches user's role, show
      if (notification.target_role && notification.target_role === userRole) return true;
      
      return false;
    }).sort((a, b) => {
      // Sort by created_at descending (newest first)
      const dateA = new Date(a.created_at);
      const dateB = new Date(b.created_at);
      return dateB.getTime() - dateA.getTime();
    });

    // Fetch read status for this user
    const readStatusQuery = `SELECT notification_id FROM notification_admin_read_status WHERE user_email = ?`;
    const readStatusResult = await client.execute(readStatusQuery, [userEmail], { prepare: true });

    const readNotificationIds = new Set(
      readStatusResult.rows.map(row => row.notification_id.toString())
    );

    // Format notifications with read status
    const notifications = filteredNotifications.map(notification => ({
      id: notification.id.toString(),
      message: notification.message,
      created_at: notification.created_at || new Date(),
      is_read: readNotificationIds.has(notification.id.toString()),
      target_email: notification.target_email,
      target_role: notification.target_role,
      target_all: notification.target_all
    }));

    res.json({
      success: true,
      notifications: notifications
    });

  } catch (error) {
    console.error("❌ Error fetching admin notifications:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch notifications",
      error: error.message
    });
  }
});

// POST /api/admin/notifications/mark-read - Mark notification as read
router.post("/notifications/mark-read", verifyToken, async (req, res) => {
  try {
    const userEmail = req.user.email;
    const { notification_id } = req.body;

    if (!notification_id) {
      return res.status(400).json({
        success: false,
        message: "Notification ID is required"
      });
    }

    // Ensure table exists
    await ensureNotificationAdminReadStatusTable();

    const query = `
      INSERT INTO notification_admin_read_status (user_email, notification_id, is_read, read_at)
      VALUES (?, ?, true, toTimestamp(now()))
    `;

    await client.execute(
      query,
      [userEmail, require('cassandra-driver').types.Uuid.fromString(notification_id)],
      { prepare: true }
    );

    console.log(`✅ Notification marked as read: ${notification_id} for user: ${userEmail}`);
    res.json({
      success: true,
      message: "Notification marked as read"
    });

  } catch (error) {
    console.error("❌ Error marking notification as read:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark notification as read",
      error: error.message
    });
  }
});

// GET /api/admin/notifications/unread-count - Get unread count
router.get("/notifications/unread-count", verifyToken, async (req, res) => {
  try {
    const userEmail = req.user.email;
    const userRole = req.user.role;

    // Ensure tables exist
    await ensureNotificationAdminTable();
    await ensureNotificationAdminReadStatusTable();

    // Fetch all notifications
    const notificationsQuery = `SELECT id, target_email, target_role, target_all FROM notification_admin`;
    const notificationsResult = await client.execute(notificationsQuery, [], { prepare: true });

    // Filter notifications based on targeting
    const filteredNotifications = notificationsResult.rows.filter(notification => {
      // If target_all is true, count for everyone
      if (notification.target_all) return true;
      
      // If target_email matches user's email, count
      if (notification.target_email && notification.target_email === userEmail) return true;
      
      // If target_role matches user's role, count
      if (notification.target_role && notification.target_role === userRole) return true;
      
      return false;
    });

    const totalCount = filteredNotifications.length;

    // Get read count for this user
    const readQuery = `SELECT COUNT(*) as count FROM notification_admin_read_status WHERE user_email = ?`;
    const readResult = await client.execute(readQuery, [userEmail], { prepare: true });
    const readCount = readResult.rows[0].count;

    // Calculate unread count
    const unreadCount = totalCount - readCount;

    res.json({
      success: true,
      count: Math.max(0, unreadCount)
    });

  } catch (error) {
    console.error("❌ Error getting unread count:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get unread count",
      error: error.message
    });
  }
});

// GET /api/admin/all-subjects - Get all tuitions/subjects from teachers table with teacher details
router.get("/all-subjects", verifyToken, async (req, res) => {
  try {
    console.log("📊 Fetching all tuitions/subjects with teacher details");

    // Fetch all teachers with their tuitions
    const teachersQuery = `SELECT email, name, profilepic, tuitions, category FROM teachers1 ALLOW FILTERING`;
    const teachersResult = await client.execute(teachersQuery, [], { prepare: true });

    // Flatten all tuitions from all teachers
    const allTuitions = [];
    teachersResult.rows.forEach(teacher => {
      if (teacher.tuitions) {
        try {
          const tuitionsArray = typeof teacher.tuitions === 'string' 
            ? JSON.parse(teacher.tuitions) 
            : teacher.tuitions;
          
          if (Array.isArray(tuitionsArray)) {
            tuitionsArray.forEach((tuition, index) => {
              allTuitions.push({
                ...tuition,
                teacher_email: teacher.email,
                teacher_name: teacher.name || 'Unknown',
                teacher_profilepic: teacher.profilepic || null,
                teacher_category: teacher.category || 'Subject teacher',
                tuition_index: index
              });
            });
          }
        } catch (err) {
          console.error(`❌ Error parsing tuitions for ${teacher.email}:`, err.message);
        }
      }
    });

    res.json({
      success: true,
      subjects: allTuitions,
      total: allTuitions.length
    });

  } catch (error) {
    console.error("❌ Error fetching all tuitions:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch tuitions",
      error: error.message
    });
  }
});

// GET /api/admin/published-subjects - Get all published subjects from subjects table with teacher details
router.get("/published-subjects", verifyToken, async (req, res) => {
  try {
    console.log("📊 Fetching all published subjects with teacher details");

    // Fetch all subjects
    const subjectsQuery = `SELECT * FROM subjects ALLOW FILTERING`;
    const subjectsResult = await client.execute(subjectsQuery, [], { prepare: true });

    // Get unique teacher emails from subjects
    const teacherEmails = [...new Set(subjectsResult.rows.map(row => row.teacher_email))];

    // Fetch teacher details for all unique teacher emails
    const teacherDetails = {};
    for (const email of teacherEmails) {
      try {
        const teacherQuery = `SELECT name, email, profilepic FROM teachers1 WHERE email = ?`;
        const teacherResult = await client.execute(teacherQuery, [email], { prepare: true });
        if (teacherResult.rows.length > 0) {
          teacherDetails[email] = teacherResult.rows[0];
        } else {
          // Fallback to users table if not in teachers1
          const userQuery = `SELECT name, email FROM users WHERE email = ? ALLOW FILTERING`;
          const userResult = await client.execute(userQuery, [email], { prepare: true });
          if (userResult.rows.length > 0) {
            teacherDetails[email] = userResult.rows[0];
          }
        }
      } catch (err) {
        console.error(`❌ Error fetching teacher details for ${email}:`, err.message);
      }
    }

    // Combine subjects with teacher details
    const subjectsWithTeachers = subjectsResult.rows.map(subject => ({
      ...subject,
      teacher_name: teacherDetails[subject.teacher_email]?.name || 'Unknown',
      teacher_profilepic: teacherDetails[subject.teacher_email]?.profilepic || null
    }));

    res.json({
      success: true,
      subjects: subjectsWithTeachers,
      total: subjectsWithTeachers.length
    });

  } catch (error) {
    console.error("❌ Error fetching all published subjects:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch published subjects",
      error: error.message
    });
  }
});

// POST /api/admin/certify-tutor - Set isCertified to true for a tutor
router.post("/certify-tutor", verifyToken, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required"
      });
    }

    // Update iscertified to true for the tutor
    const updateQuery = `UPDATE tutors SET iscertified = true WHERE email = ?`;
    await client.execute(updateQuery, [email], { prepare: true });

    console.log("✅ Tutor certified successfully:", email);

    res.json({
      success: true,
      message: "Tutor certified successfully"
    });

  } catch (error) {
    console.error("❌ Error certifying tutor:", error);
    res.status(500).json({
      success: false,
      message: "Failed to certify tutor",
      error: error.message
    });
  }
});

// DELETE /api/admin/tutor-certificate - Delete tutor certificate
router.delete("/tutor-certificate", verifyToken, async (req, res) => {
  try {
    const { email, certificationUrl } = req.body;

    if (!email || !certificationUrl) {
      return res.status(400).json({
        success: false,
        message: "Email and certification URL are required"
      });
    }

    console.log("🗑️ Deleting certificate for:", email);

    // Get tutor's id and current certifications
    const getTutorQuery = `SELECT id, certification FROM tutors WHERE email = ? ALLOW FILTERING`;
    const tutorResult = await client.execute(getTutorQuery, [email], { prepare: true });

    if (tutorResult.rowLength === 0) {
      return res.status(404).json({
        success: false,
        message: "Tutor not found"
      });
    }

    const tutor = tutorResult.rows[0];
    const currentCertifications = tutor.certification || [];

    // Remove the specific certificate URL from the array
    const updatedCertifications = currentCertifications.filter(cert => cert !== certificationUrl);

    // Update the tutor's certifications
    const updateQuery = `UPDATE tutors SET certification = ? WHERE id = ? AND email = ?`;
    await client.execute(updateQuery, [updatedCertifications, tutor.id, email], { prepare: true });

    console.log("✅ Certificate deleted successfully for:", email);

    res.json({
      success: true,
      message: "Certificate deleted successfully"
    });
  } catch (error) {
    console.error("❌ Error deleting certificate:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete certificate",
      error: error.message
    });
  }
});

// POST /api/admin/accept-tutor-certificate - Accept tutor certificate
router.post("/accept-tutor-certificate", verifyToken, async (req, res) => {
  try {
    const { email, certificationUrl } = req.body;

    if (!email || !certificationUrl) {
      return res.status(400).json({
        success: false,
        message: "Email and certification URL are required"
      });
    }

    console.log("✅ Accepting certificate for:", email);

    // In a real implementation, you might want to:
    // 1. Add a certification status field to the tutors table
    // 2. Update a separate certifications table with acceptance status
    // 3. Send a notification to the tutor

    // For now, we'll just return success since the certificate is already stored
    // In the future, you might add a certification_status field

    console.log("✅ Certificate accepted successfully for:", email);

    res.json({
      success: true,
      message: "Certificate accepted successfully"
    });
  } catch (error) {
    console.error("❌ Error accepting certificate:", error);
    res.status(500).json({
      success: false,
      message: "Failed to accept certificate",
      error: error.message
    });
  }
});

// DELETE /api/admin/delete-certificate - Delete certificate data for a teacher
router.delete("/delete-certificate", verifyToken, async (req, res) => {
  try {
    const { teacherEmail } = req.query;

    if (!teacherEmail) {
      return res.status(400).json({
        success: false,
        message: "Teacher email is required"
      });
    }

    console.log("🗑️ Deleting certificate data for:", teacherEmail);

    // Get tutor's id
    const getTutorQuery = `SELECT id FROM tutors WHERE email = ? ALLOW FILTERING`;
    const tutorResult = await client.execute(getTutorQuery, [teacherEmail], { prepare: true });

    if (tutorResult.rowLength === 0) {
      return res.status(404).json({
        success: false,
        message: "Tutor not found"
      });
    }

    const tutor = tutorResult.rows[0];

    // Update the tutor's certification to null
    const updateQuery = `UPDATE tutors SET certification = null, iscertified = null WHERE id = ? AND email = ?`;
    await client.execute(updateQuery, [tutor.id, teacherEmail], { prepare: true });

    console.log("✅ Certificate data deleted successfully for:", teacherEmail);

    res.json({
      success: true,
      message: "Certificate deleted successfully"
    });
  } catch (error) {
    console.error("❌ Error deleting certificate:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete certificate",
      error: error.message
    });
  }
});

// POST /api/admin/accept-certificate - Accept certificate and set iscertified to True
router.post("/accept-certificate", verifyToken, async (req, res) => {
  try {
    const { teacherEmail } = req.query;

    if (!teacherEmail) {
      return res.status(400).json({
        success: false,
        message: "Teacher email is required"
      });
    }

    console.log("✅ Accepting certificate for:", teacherEmail);

    // Get tutor's id
    const getTutorQuery = `SELECT id FROM tutors WHERE email = ? ALLOW FILTERING`;
    const tutorResult = await client.execute(getTutorQuery, [teacherEmail], { prepare: true });

    if (tutorResult.rowLength === 0) {
      return res.status(404).json({
        success: false,
        message: "Tutor not found"
      });
    }

    const tutor = tutorResult.rows[0];

    // Update the tutor's iscertified to true
    const updateQuery = `UPDATE tutors SET iscertified = true WHERE id = ? AND email = ?`;
    await client.execute(updateQuery, [tutor.id, teacherEmail], { prepare: true });

    console.log("✅ Certificate accepted successfully for:", teacherEmail);

    res.json({
      success: true,
      message: "Certificate accepted successfully"
    });
  } catch (error) {
    console.error("❌ Error accepting certificate:", error);
    res.status(500).json({
      success: false,
      message: "Failed to accept certificate",
      error: error.message
    });
  }
});

module.exports = router;