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
        const { email, otp, name, phonenumber } = req.body;

        if (!email || !otp || !name || !phonenumber) {
            return res.status(400).json({
                message: "❌ Email, OTP, Full Name, and Phone Number are required",
            });
        }

        // Check if already registered
        const checkUserQuery = "SELECT email FROM users WHERE email = ? ALLOW FILTERING";
        const userResult = await client.execute(checkUserQuery, [email], { prepare: true });

        if (userResult.rowLength > 0) {
            if (userResult.rows[0].status === "active") {
                return res.status(400).json({
                    message: "❌ This email is already registered. Please login instead.",
                    alreadyRegistered: true,
                });
            }
        }

        const query = "SELECT * FROM otp_table WHERE email = ? ALLOW FILTERING";
        const result = await client.execute(query, [email], { prepare: true });

        if (result.rowLength === 0) {
            return res.status(400).json({ message: "❌ OTP not found or invalid email" });
        }

        const latestOTP = result.rows.sort((a, b) => new Date(b.expires_at) - new Date(a.expires_at))[0];
        console.log("otp",latestOTP)
        if (latestOTP.otp.toString() !== otp.toString()) {
            return res.status(400).json({ message: "❌ Incorrect OTP" });
        }

        if (new Date(latestOTP.expires_at) < new Date()) {
            return res.status(400).json({ message: "❌ OTP has expired" });
        }

        // ✅ Insert user
        const userId = uuidv4();
        const now = new Date();
        const createUserQuery = `
      INSERT INTO users (id, email, name, phonenumber, created_at)
      VALUES (?, ?, ?, ?, ?)
    `;
        await client.execute(createUserQuery, [userId, email, name, phonenumber, now], { prepare: true });

        //Delete OTP
        const deleteQuery = "DELETE FROM otp_table WHERE email = ? AND id = ?";
        await client.execute(deleteQuery, [email, latestOTP.id], { prepare: true });
        const token = jwt.sign({email},process.env.JWT_SECRET_KEY,{expiresIn:'7d'})
        return res.json({ message: "✅ OTP verified and user created successfully",token ,userId});
    } catch (error) {
        console.error("❌ Error verifying OTP:", error.message);
        return res.status(500).json({ message: "Failed to verify OTP" });
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