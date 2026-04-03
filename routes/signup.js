const express = require("express");
const { v4: uuidv4 } = require("uuid");
const nodemailer = require("nodemailer");
const cassandra = require("cassandra-driver");
const rateLimiter = require("../middleware/rateLimiter");

const router = express.Router();
const client = require("../config/db");
const transporter = require("../config/mail");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const multerS3 = require("multer-s3");
const verifyToken = require('./../utils/verifyToken')
const s3 = require("../config/s3");

const upload = multer({
    storage: multerS3({
        s3: s3,
        bucket: process.env.S3_BUCKET_NAME,
        metadata: (req, file, cb) => {
            cb(null, { fieldName: file.fieldname });
        },
        key: (req, file, cb) => {
            const fileName = `${Date.now()}-${file.originalname}`;
            cb(null, `documents/${fileName}`);
        }
    })
});

// Generate OTP
const generateOTP = () => Math.floor(1000 + Math.random() * 9000).toString();

const toTimestamp = () => new Date().toISOString();

// Signup route
router.post("/signup", async (req, res) => {
    try {
        const { fullName, phonenumber, email, role = 'student' } = req.body;
        
        // Validation
        if (!email) return res.status(400).json({ message: "❌ Email is required" });
        if (!fullName) return res.status(400).json({ message: "❌ Full Name is required" });
        if (!phonenumber) return res.status(400).json({ message: "❌ Phone Number is required" });
        
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ message: "❌ Invalid email format" });
        }

        // Validate role
        if (!role || !['student', 'teacher'].includes(role)) {
            return res.status(400).json({ message: "❌ Invalid role. Must be 'student' or 'teacher'" });
        }

        // Check if user already exists
        try {
            const checkUserQuery = "SELECT email FROM users WHERE email = ? ALLOW FILTERING";
            const userResult = await client.execute(checkUserQuery, [email], { prepare: true });

            if (userResult.rowLength > 0) {
                if (userResult.rows[0].status === "active") {
                    return res.status(400).json({
                        message: "❌ This email is already registered. Please login instead.",
                        alreadyRegistered: true
                    });
                }
            }
        } catch (checkError) {
            console.error("Error checking user:", checkError);
        }

        // Generate OTP
        const otp = generateOTP();
        console.log("Generated OTP for:", email);
        const otpId = uuidv4();
        const expirationTime = new Date(Date.now() + 2 * 60 * 1000);

        // Store OTP
        const query = "INSERT INTO otp_table (id, email, otp, expires_at, user_data) VALUES (?, ?, ?, ?, ?)";
        const userData = JSON.stringify({ fullName, phonenumber, role });
        const params = [otpId, email, otp, expirationTime, userData];
        await client.execute(query, params, { prepare: true });

        // Send OTP email
        const mailOptions = {
            from: `Your App <${process.env.EMAIL_USER}>`,
            to: email,
            subject: "Your OTP Code",
            text: `Your OTP code is: ${otp}. It is valid for 2 minutes.\n\nAccount Details:\nName: ${fullName}\nPhone: ${phonenumber}\nRole: ${role}`,
        };

        try {
            await transporter.sendMail(mailOptions);
            console.log("✅ OTP Sent Successfully!");
        } catch (emailError) {
            console.error("❌ Error sending OTP via email:", emailError);
            console.log(`🔧 FALLBACK: OTP for ${email} is: ${otp} (valid for 2 minutes)`);
            // Continue with flow even if email fails
        }

        res.json({ 
            message: "✅ OTP sent successfully", 
            otpId,
            userData: { fullName, phonenumber, email, role }
        });
    } catch (error) {
        console.error("❌ Signup error:", error);
        res.status(500).json({ message: "❌ Internal server error" });
    }
});

// Verify OTP route
// Verify OTP route
router.post("/signup/verify-otp", /* rateLimiter.otpLimiter, rateLimiter.concurrentLimiter(3), */ async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { email, otp } = req.body;
        if (!email || !otp) {
            return res.status(400).json({ message: "❌ Email and OTP are required" });
        }

        console.log(`🔍 OTP verification for: ${email}`);

        // Get latest OTP with user data
        const getOTPQuery = "SELECT otp, expires_at, user_data FROM otp_table WHERE email = ? ORDER BY id DESC LIMIT 1";
        const otpResult = await client.execute(getOTPQuery, [email], { prepare: true });

        if (otpResult.rowLength === 0) {
            return res.status(400).json({ message: "❌ OTP not found or expired" });
        }

        const latestOTP = otpResult.rows[0];
        
        // Check if OTP has expired
        if (latestOTP.expires_at && new Date(latestOTP.expires_at) < new Date()) {
            return res.status(400).json({ message: "❌ OTP has expired" });
        }

        if (latestOTP.otp !== otp) {
            return res.status(400).json({ message: "❌ Invalid OTP" });
        }

        // Extract user data from OTP
        let userData;
        try {
            userData = JSON.parse(latestOTP.user_data);
        } catch (parseError) {
            console.error("Error parsing user data:", parseError);
            return res.status(400).json({ message: "❌ Invalid user data" });
        }

        const { fullName, phonenumber, role } = userData;

        // Generate user ID
        const userId = uuidv4();

        // Insert user with correct role
        const insertUserQuery = "INSERT INTO users (id, email, name, phonenumber, role, status, created_at) VALUES (?, ?, ?, ?, ?, 'active', ?)";
        await client.execute(insertUserQuery, [userId, email, fullName, phonenumber, role, toTimestamp()], { prepare: true });

        // Insert role-specific record
        if (role === 'student') {
            const insertStudentQuery = "INSERT INTO student (email, name, profileimage, class_year) VALUES (?, ?, '', '10')";
            await client.execute(insertStudentQuery, [email, fullName], { prepare: true });
        } else if (role === 'teacher') {
            const insertTeacherQuery = "INSERT INTO tutors (id, email, full_name, phone_number, status, created_at) VALUES (?, ?, ?, 'pending', ?)";
            await client.execute(insertTeacherQuery, [userId, email, fullName, phonenumber, toTimestamp()], { prepare: true });
        }

        // Delete OTP
        const deleteOTPQuery = "DELETE FROM otp_table WHERE email = ? AND id = (SELECT id FROM otp_table WHERE email = ? ORDER BY id DESC LIMIT 1)";
        await client.execute(deleteOTPQuery, [email, email], { prepare: true });

        // Generate JWT token
        const token = jwt.sign({
            email: email,
            role: role,
            name: fullName
        }, process.env.JWT_SECRET_KEY, { expiresIn: '7d' });

        // Invalidate any cached data for this email
        // await cache.invalidateUser(email); // Comment out if cache doesn't exist

        console.log(`✅ User created successfully: ${email} with role: ${role}`);

        const responseTime = Date.now() - startTime;
        res.json({
            message: "✅ Account created successfully",
            token: token,
            userId: userId,
            role: role,
            responseTime: responseTime
        });
    } catch (error) {
        console.error("❌ OTP verification error:", error);
        res.status(500).json({ message: "❌ Internal server error" });
    }
});

router.post(
    "/register",
    upload.fields([
        { name: "panUpload", maxCount: 1 },
        { name: "aadhar_front", maxCount: 1 },  // ✅ NEW FIELD NAME
        { name: "aadhar_back", maxCount: 1 },   // ✅ NEW FIELD NAME
        { name: "selfieWith_addhar_front", maxCount: 1 },
        { name: "selfieWith_aadhar_back", maxCount: 1 },
        { name: "certification", maxCount: 5 },
        { name: "heighest_qualification", maxCount: 5 },
    ]),
    async (req, res) => {
        try {
            const {
                userId,
                fullname,
                phoneNumber,
                email,
                residentialAddress,
                state,
                country,
                experience,
                specialization,
            } = req.body;

            const getFileUrl = (field) =>
                req.files[field]?.[0]?.location || null;

            const getArrayFileUrls = (field) =>
                req.files[field]?.map((file) => file.location) || [];

            // const aadharUrl = getFileUrl("aadharUpload");
            const aadharFrontUrl = getFileUrl("aadhar_front");
            const aadharBackUrl = getFileUrl("aadhar_back");
            const panUrl = getFileUrl("panUpload");
            const selfieWithaadharFrontUrl = getFileUrl("selfieWith_addhar_front");
            const selfieWithaadharBackUrl = getFileUrl("selfieWith_aadhar_back");
            const heighestQualificationUrls = getArrayFileUrls("heighest_qualification");
            const certificationUrls = getArrayFileUrls("certification");

          const query = `
                INSERT INTO tutors(
                    id, email, aadhar_front, aadhar_back, certification, country, experience, full_name,
                    heighest_qualification_certification, pan, phone_number, residentialAddress,
                    selfie_with_aadhar_back, selfie_with_aadhar_front, specialization, state
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            const values = [
                userId,
                email,
                aadharFrontUrl,    // ✅ NEW
                aadharBackUrl,     // ✅ NEW
                certificationUrls,
                country,
                experience,
                fullname,
                heighestQualificationUrls,
                panUrl,
                phoneNumber,
                residentialAddress,
                selfieWithaadharBackUrl,
                selfieWithaadharFrontUrl,
                specialization,
                state,
            ];

            await client.execute(query, values, { prepare: true });

            res.status(200).json({ message: "Your Documents Submitted." });
        } catch (error) {
            console.error("❌ Error Registration error:", error.message);
            res.status(500).json({ message: "Failed to Register" });
        }
    }
);

// Add this route to signup.js
router.post("/update-tutor-degree", verifyToken, async (req, res) => {
    try {
        const { email, heighest_degree } = req.body;

        if (!email) {
            return res.status(400).json({ message: "Email is required" });
        }

        const query = "UPDATE tutors SET heighest_degree = ? WHERE email = ?";
        await client.execute(query, [heighest_degree, email], { prepare: true });

        res.status(200).json({ message: "Highest degree updated successfully" });
    } catch (error) {
        console.error("❌ Error updating highest degree:", error.message);
        res.status(500).json({ message: "Failed to update highest degree" });
    }
});




module.exports = router;