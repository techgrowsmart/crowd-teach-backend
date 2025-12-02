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

        await transporter.sendMail(mailOptions);
        console.log("✅ OTP Sent Successfully!");

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


        const userQuery = "SELECT role FROM users WHERE email = ?";
        const userResult = await client.execute(userQuery, [email], { prepare: true });

        if (userResult.rowLength === 0) {
            return res.status(404).json({ message: "❌ User not found" });
        }

        const user = userResult.rows[0];
        const token = jwt.sign({email},process.env.JWT_SECRET_KEY,{expiresIn:'7d'})
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

module.exports = router;
