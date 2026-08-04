const express = require("express");
const { v4: uuidv4 } = require("uuid");
const nodemailer = require("nodemailer");
const cassandra = require("cassandra-driver");
const jwt = require("jsonwebtoken");
const verifyToken = require('./../utils/verifyToken');
const client = require("../config/db");
const transporter = require("../config/mail");
const { generateReferralCode } = require("../utils/referralHelper");

const router = express.Router();

const generateOTP = () => Math.floor(1000 + Math.random() * 9000).toString();

// ─────────────────────────────────────────────────────────────
// 1. Send OTP
// ─────────────────────────────────────────────────────────────
router.post("/signup", async (req, res) => {
    try {
        const { fullName, phonenumber, email } = req.body;
        if (!email) return res.status(400).json({ message: "❌ Email is required" });
        if (!fullName) return res.status(400).json({ message: "❌ Full Name is required" });
        if (!phonenumber) return res.status(400).json({ message: "❌ Phone Number is required" });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ message: "❌ Invalid email format" });
        }

        // Check if user already exists
        try {
            const checkUserQuery = "SELECT email, status FROM users WHERE email = ? ALLOW FILTERING";
            const userResult = await client.execute(checkUserQuery, [email], { prepare: true });
            if (userResult.rowLength > 0 && userResult.rows[0].status.toLowerCase() === 'active') {
                return res.status(400).json({
                    message: "❌ This email is already registered. Please login instead.",
                    alreadyRegistered: true
                });
            }
            if (userResult.rowLength > 0 && userResult.rows[0].status.toLowerCase() === 'inactive') {
                return res.status(403).json({
                    message: 'Account on hold',
                    accountStatus: 'inactive',
                    onHoldMessage: 'due to some violations your account is on hold Try contacting admin of growsmart'
                });
            }
        } catch (checkError) {
            console.error("Error checking user:", checkError);
        }

        const otp = generateOTP();

        // ✅ Test user hardcoded OTP bypass
        const TEST_USERS = ['student1@example.com', 'teacher1@example.com'];
        const TEST_OTP = '1234';

        if (TEST_USERS.includes(email)) {
            console.log(`🧪 Test user detected in signup: ${email}. Using hardcoded OTP: ${TEST_OTP}`);
            otp = TEST_OTP;
        }

        console.log("otp", otp);
        const otpId = uuidv4();
        const expirationTime = new Date(Date.now() + 2 * 60 * 1000);

        const query = "INSERT INTO otp_table (id, email, otp, expires_at) VALUES (?, ?, ?, ?)";
        const params = [otpId, email, otp, expirationTime];
        await client.execute(query, params, { prepare: true });

        const mailOptions = {
            from: `Your App <${process.env.EMAIL_USER}>`,
            to: email,
            subject: "Your OTP Code",
            text: `Your OTP code is: ${otp}. It is valid for 2 minutes.`,
        };
//comment below
        try {
            //till here
            await transporter.sendMail(mailOptions);
            //comment below
            console.log("✅ OTP Sent Successfully!");
        } catch (emailError) {
            console.error("❌ Error sending OTP via email:", emailError);
            console.log(`🔧 FALLBACK: OTP for ${email} is: ${otp} (valid for 2 minutes)`);
            // Continue with the flow even if email fails
        }
//till here
        res.json({ message: "✅ OTP sent successfully", otpId });
    } catch (error) {
        console.error("❌ Error sending OTP:", error.message);
        res.status(500).json({ message: "Failed to send OTP" });
    }
});

// ─────────────────────────────────────────────────────────────
// 2. Verify OTP and CREATE USER (with referral handling)
// ─────────────────────────────────────────────────────────────
router.post("/signup/verify-otp", async (req, res) => {
    try {
        const { email, otp, name, phonenumber } = req.body;
        const refCode = req.query.ref;

        console.log("🔍 OTP verification request:", { email, otp, refCode });

        if (!email || !otp) {
            return res.status(400).json({ message: "❌ Email and OTP are required" });
        }

        // Check if user account is inactive/on hold before allowing signup
        const statusCheckQuery = "SELECT status FROM users WHERE email = ? ALLOW FILTERING";
        const statusResult = await client.execute(statusCheckQuery, [email], { prepare: true });

        if (statusResult.rowLength > 0) {
            const existingUser = statusResult.rows[0];
            if (existingUser.status.toLowerCase() === 'inactive') {
                return res.status(403).json({
                    message: 'Account on hold',
                    accountStatus: 'inactive',
                    onHoldMessage: 'due to some violations your account is on hold Try contacting admin of growsmart'
                });
            }
        }

        // ✅ Test user hardcoded OTP bypass
        const TEST_USERS = ['student1@example.com', 'teacher1@example.com'];
        const TEST_OTP = '1234';

        if (TEST_USERS.includes(email) && otp === TEST_OTP) {
            console.log(`🧪 Test OTP bypass for signup: ${email}`);

            // Clean up any existing OTPs for this email
            const deleteQuery = "DELETE FROM otp_table WHERE email = ?";
            await client.execute(deleteQuery, [email], { prepare: true });

            // Check if user already exists
            const checkExistingQuery = "SELECT email FROM users WHERE email = ? ALLOW FILTERING";
            const existingResult = await client.execute(checkExistingQuery, [email], { prepare: true });
            if (existingResult.rowLength > 0) {
                return res.status(409).json({
                    message: "❌ This email is already registered. Please login instead.",
                    alreadyRegistered: true
                });
            }

            // CREATE NEW USER
            const userId = uuidv4();
            const newReferralCode = generateReferralCode(userId);
            const userName = name || email.split('@')[0];
            const userPhone = phonenumber || '';

            const userQuery = `
                INSERT INTO users (id, email, name, phonenumber, created_at, status, referral_code, referral_count)
                VALUES (?, ?, ?, ?, ?, ?, ?, 0)
            `;
            await client.execute(userQuery, [
                userId, email, userName, userPhone, new Date(), 'active', newReferralCode
            ], { prepare: true });

            // Generate JWT token
            const token = jwt.sign(
                { userId, email },
                process.env.JWT_SECRET_KEY,
                { expiresIn: '7d' }
            );

            res.json({
                success: true,
                message: "✅ Account created successfully (test mode)",
                token: token,
                email: email,
                name: userName,
                userId: userId
            });
            return;
        }

        // Verify OTP
        const query = "SELECT * FROM otp_table WHERE email = ? AND expires_at > ? ALLOW FILTERING";
        const currentTime = new Date();
        const result = await client.execute(query, [email, currentTime], { prepare: true });

        if (result.rowLength === 0) {
            return res.status(400).json({ message: "❌ OTP not found or expired" });
        }

        const storedOTP = result.rows[0];
        if (storedOTP.otp !== otp) {
            return res.status(400).json({ message: "❌ Invalid OTP" });
        }

        console.log("✅ OTP verification successful for:", email);

        // Delete used OTP
        const deleteQuery = "DELETE FROM otp_table WHERE email = ? AND id = ?";
        await client.execute(deleteQuery, [email, storedOTP.id], { prepare: true });

        // Final check – prevent duplicate user creation
        const checkExistingQuery = "SELECT email FROM users WHERE email = ? ALLOW FILTERING";
        const existingResult = await client.execute(checkExistingQuery, [email], { prepare: true });
        if (existingResult.rowLength > 0) {
            return res.status(409).json({
                message: "❌ This email is already registered. Please login instead.",
                alreadyRegistered: true
            });
        }

        // CREATE NEW USER
        const userId = uuidv4();
        const newReferralCode = generateReferralCode(userId);
        const userName = name || email.split('@')[0];
        const userPhone = phonenumber || '';

        const userQuery = `
            INSERT INTO users (id, email, name, phonenumber, created_at, status, referral_code, referral_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        `;
        await client.execute(userQuery, [
            userId, email, userName, userPhone, new Date(), 'active', newReferralCode
        ], { prepare: true });

        // Process referral if provided
        if (refCode) {
            console.log(`🔍 Processing referral code: ${refCode}`);
            try {
                const findReferrerQuery = `SELECT id FROM users WHERE referral_code = ? ALLOW FILTERING`;
                const referrerResult = await client.execute(findReferrerQuery, [refCode], { prepare: true });
                if (referrerResult.rowLength > 0) {
                    const referrerId = referrerResult.rows[0].id;
                    if (referrerId.toString() !== userId.toString()) {
                        const eventQuery = `INSERT INTO referral_events (referrer_id, referred_user_id, created_at) VALUES (?, ?, ?)`;
                        await client.execute(eventQuery, [referrerId, userId, new Date()], { prepare: true });

                        const selectCount = `SELECT referral_count FROM users WHERE id = ?`;
                        const countRes = await client.execute(selectCount, [referrerId], { prepare: true });
                        let currentCount = countRes.rows[0]?.referral_count ?? 0;
                        currentCount++;
                        const updateCount = `UPDATE users SET referral_count = ? WHERE id = ?`;
                        await client.execute(updateCount, [currentCount, referrerId], { prepare: true });

                        console.log(`✅ Referral recorded: ${refCode} → ${email}, new count = ${currentCount}`);

                        const setRefBy = `UPDATE users SET referred_by = ? WHERE id = ?`;
                        await client.execute(setRefBy, [referrerId, userId], { prepare: true });
                    } else {
                        console.log(`⏭️ Self-referral ignored for ${email}`);
                    }
                } else {
                    console.log(`⚠️ No user found with referral code: ${refCode}`);
                }
            } catch (refError) {
                console.error('❌ Referral processing error:', refError);
            }
        }

        // Generate JWT token
        const token = jwt.sign(
            { userId, email },
            process.env.JWT_SECRET_KEY,
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            message: "✅ Account created successfully",
            token: token,
            email: email,
            name: userName,
            userId: userId
        });
    } catch (error) {
        console.error("❌ OTP verification error:", error);
        res.status(500).json({ message: "❌ Internal server error" });
    }
});

// ─────────────────────────────────────────────────────────────
// 3. Teacher registration – DPDP Compliant (No Document Storage)
// ─────────────────────────────────────────────────────────────
router.post("/register", async (req, res) => {
    try {
        console.log("📝 DPDP Compliant Teacher registration request received");
        const {
            fullname, phoneNumber, residentialAddress, state, country,
            experience, specialization, highest_degree, email, userId,
            kyc_self_declared, dpdp_consent, aadhaar_verified
        } = req.body;

        // Validate required fields
        if (!email || !fullname || !phoneNumber) {
            return res.status(400).json({ success: false, message: "Missing required fields" });
        }

        // ✅ Get the correct user ID from the users table
        const userQuery = "SELECT id FROM users WHERE email = ?";
        const userRes = await client.execute(userQuery, [email], { prepare: true });
        if (userRes.rowLength === 0) {
            return res.status(404).json({ success: false, message: "User not found. Please sign up first." });
        }
        const correctUserId = userRes.rows[0].id;

        // ✅ Find existing tutor records for this email
        const findQuery = "SELECT id FROM tutors WHERE email = ? ALLOW FILTERING";
        const existing = await client.execute(findQuery, [email], { prepare: true });

        // Delete any tutor record with a different ID (wrong partition key)
        for (const row of existing.rows) {
            if (row.id.toString() !== correctUserId.toString()) {
                await client.execute(
                    "DELETE FROM tutors WHERE id = ? AND email = ?",
                    [row.id, email],
                    { prepare: true }
                );
                console.log(`🗑️ Deleted wrong tutor record for ${email} (old ID: ${row.id})`);
            }
        }

        // ✅ Insert DPDP compliant tutor record (no documents stored)
        const query = `
            INSERT INTO tutors(
                id, email, country, experience, full_name, heighest_degree, 
                phone_number, residentialaddress, specialization, state,
                kyc_self_declared, dpdp_consent, aadhaar_verified, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        const values = [
            correctUserId, email, country || 'India', experience, fullname, highest_degree || '',
            phoneNumber, residentialAddress, specialization, state,
            kyc_self_declared === 'true' || false,
            dpdp_consent === 'true' || false,
            aadhaar_verified === 'true' || false,
            new Date()
        ];
        await client.execute(query, values, { prepare: true });

        console.log(`✅ DPDP Compliant Tutor registration successful for ${email} with ID ${correctUserId}`);
        console.log(`   - KYC Declared: ${kyc_self_declared}`);
        console.log(`   - DPDP Consent: ${dpdp_consent}`);
        console.log(`   - Aadhaar Verified: ${aadhaar_verified}`);
        console.log(`   - No documents stored (DPDP compliant)`);
        
        res.status(200).json({ 
            success: true, 
            message: "✅ Registration completed successfully. No personal documents stored as per DPDP Act." 
        });
    } catch (error) {
        console.error("❌ Registration error:", error);
        res.status(500).json({ success: false, message: "Internal server error", error: error.message });
    }
});
// ─────────────────────────────────────────────────────────────
// 4. Test Route (Debug)
// ─────────────────────────────────────────────────────────────
router.post("/test-route", async (req, res) => {
    console.log("🔍 Test route hit!");
    res.json({ message: "Test route working!" });
});

// ─────────────────────────────────────────────────────────────
// 5. Update tutor degree
// ─────────────────────────────────────────────────────────────
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