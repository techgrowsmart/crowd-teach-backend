const express = require("express")
const router = express.Router()
const client = require("../config/db");
const verifyToken = require("./../utils/verifyToken")
router.get("/student-wallet-balance",verifyToken, async (req, res) => {
    try {
        const { email } = req.query;
        if (!email) {
            return res.status(400).json({ message: "Email is required" });
        }

        const result = await client.execute(
            "SELECT balance FROM student_wallets WHERE email = ?",
            [email]
        );

        if (result.rowLength === 0) {
            // Wallet not created yet
            return res.status(200).json({ balance: 0 });
        }

        return res.status(200).json({ balance: result.rows[0].balance });
    } catch (error) {
        console.error("Error fetching wallet:", error);
        return res.status(500).json({ message: "Internal Server Error" });
    }
});

module.exports= router