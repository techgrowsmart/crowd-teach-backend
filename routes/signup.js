const express = require("express");
const { v4: uuidv4 } = require("uuid");
const nodemailer = require("nodemailer");
const cassandra = require("cassandra-driver");

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


const generateOTP = () => Math.floor(1000 + Math.random() * 9000).toString();


router.post("/signup", async (req, res) => {
    try {
        const { fullName,phonenumber,email } = req.body;
        if (!email) return res.status(400).json({ message: "❌ Email is required" });
        if (!fullName) return  res.status(400).json({message:"❌ Full Name is required"})
        if (!phonenumber) return  res.status(400).json({message:"❌ Phone Number is required"})
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ message: "❌ Invalid email format" });
        }


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

        const otp = generateOTP();
        console.log("otp",otp)
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

        await transporter.sendMail(mailOptions);

        res.json({ message: "✅ OTP sent successfully", otpId });
    } catch (error) {
        console.error("❌ Error sending OTP:", error.message);
        res.status(500).json({ message: "Failed to send OTP" });
    }
});

router.post("/signup/verify-otp", async (req, res) => {
    try {
        const { email, otp } = req.body;
        
        console.log("🔍 OTP verification request:", { email, otp });
        
        if (!email || !otp) {
            return res.status(400).json({ message: "❌ Email and OTP are required" });
        }

        // Verify OTP from database
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

        // CRITICAL: Double-check if user already exists (prevent race conditions)
        const checkExistingQuery = "SELECT email FROM users WHERE email = ? ALLOW FILTERING";
        const existingResult = await client.execute(checkExistingQuery, [email], { prepare: true });

        if (existingResult.rowLength > 0) {
            return res.status(409).json({
                message: "❌ This email is already registered. Please login instead.",
                alreadyRegistered: true
            });
        }

        // Create user in database
        const userId = uuidv4();
        const userQuery = "INSERT INTO users (id, email, name, phonenumber, created_at) VALUES (?, ?, ?, ?, ?)";
        await client.execute(userQuery, [userId, email, req.body.name || email.split('@')[0], req.body.phonenumber, new Date()], { prepare: true });

        // Generate real JWT token
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
            name: req.body.name || email.split('@')[0],
            userId: userId
        });
    } catch (error) {
        console.error("❌ OTP verification error:", error);
        res.status(500).json({ message: "❌ Internal server error" });
    }
});


router.post(
    "/register",
    upload.any(),
    async (req, res) => {
        try {
            console.log("📝 Teacher registration request received");
            console.log("📊 Request body fields:", Object.keys(req.body));
            console.log("📊 Request files:", Object.keys(req.files || {}));
            console.log("📊 Request body data:", req.body);

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

            // Validate required fields
            if (!email || !fullname || !phoneNumber) {
                console.error("❌ Missing required fields:", { email, fullname, phoneNumber });
                return res.status(400).json({ 
                    success: false,
                    message: "Email, full name, and phone number are required",
                    received: { email, fullname, phoneNumber }
                });
            }

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

            console.log("📊 File URLs:", {
                aadharFrontUrl: !!aadharFrontUrl,
                aadharBackUrl: !!aadharBackUrl,
                panUrl: !!panUrl,
                selfieWithaadharFrontUrl: !!selfieWithaadharFrontUrl,
                selfieWithaadharBackUrl: !!selfieWithaadharBackUrl,
                heighestQualificationUrls: heighestQualificationUrls.length,
                certificationUrls: certificationUrls.length
            });

          const query = `
                INSERT INTO tutors(
                    id, email, aadhar_front, aadhar_back, certification, country, experience, full_name,
                    heighest_degree, heighest_qualification_certification, pan, phone_number, residentialaddress,
                    selfie_with_aadhar_back, selfie_with_aadhar_front, specialization, state
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            const values = [
                (!userId || userId === 'null' || userId === 'undefined') ? uuidv4() : userId,
                email,
                aadharFrontUrl,
                aadharBackUrl,
                certificationUrls,
                country,
                experience,
                fullname,
                req.body.highest_degree || '',
                heighestQualificationUrls,
                panUrl,
                phoneNumber,
                residentialAddress,
                selfieWithaadharBackUrl,
                selfieWithaadharFrontUrl,
                specialization,
                state,
            ];

            console.log("✅ Inserting into AstraDB tutors table with values:", {
                id: values[0],
                email: values[1],
                full_name: values[7]
            });

            await client.execute(query, values, { prepare: true });

            // Update users table to set role to 'teacher' and status to 'dormant'
            // This ensures the user is properly marked as a teacher and will be routed correctly
            const updateUserQuery = "UPDATE users SET role = ?, status = ? WHERE email = ?";
            await client.execute(updateUserQuery, ['teacher', 'dormant', email], { prepare: true });

            console.log("✅ Updated user role to 'teacher' and status to 'dormant' for:", email);

            res.status(200).json({ message: "Your Documents Submitted." });
        } catch (error) {
            console.error("❌ Error Registration error:", error.message);
            console.error("❌ Full error details:", error);
            res.status(500).json({ message: "Failed to Register", error: error.message });
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