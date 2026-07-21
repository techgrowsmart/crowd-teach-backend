
const express = require("express");
const verifyToken = require("./../utils/verifyToken")
const router = express.Router();





router.post("/accept-request", verifyToken, async (req, res) => {
    const {
        requestId,
        userEmail,
        studentEmail,
        studentName,
        studentProfilePic,
        teacherName,
        teacherProfilePic
    } = req.body;

    try {
        // Connection request functionality removed - Firebase dependency eliminated
        console.log("Connection request functionality disabled - Firebase removed");
        return res.status(501).json({ error: "Connection request functionality disabled" });

    } catch (error) {
        console.error("Error accepting request:", error);
        return res.status(500).json({ error: "Failed to accept request." });
    }
});


router.post("/reject-request",verifyToken, async (req, res) => {
    const { requestId } = req.body;

    try {
        // Connection request functionality removed - Firebase dependency eliminated
        console.log("Connection request functionality disabled - Firebase removed");
        return res.status(501).json({ error: "Connection request functionality disabled" });
    } catch (error) {
        console.error("Error rejecting request:", error);
        return res.status(500).json({ error: "Failed to reject request." });
    }
});

module.exports = router;
