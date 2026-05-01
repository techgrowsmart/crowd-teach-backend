
const express = require("express");
const { Timestamp } = require("firebase-admin/firestore");
const { db } = require("../config/firebase");
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

        await db.collection("connectionRequests").doc(requestId).update({ status: "accepted" });


        await db.collection("contacts").add({
            userEmail,
            contactEmail: studentEmail,
            contactName: studentName,
            contactProfilePic: studentProfilePic || "",
        });

        await db.collection("contacts").add({
            userEmail: studentEmail,
            contactEmail: userEmail,
            contactName: teacherName || "Teacher",
            contactProfilePic: teacherProfilePic || "",
        });

        // 3. Add entry to studentTracker
        await db.collection("studentTracker").add({
            teacherEmail: userEmail,
            studentEmail,
            studentName,
            studentProfilePic: studentProfilePic || "",
            timestamp: Timestamp.now(),
        });

        return res.status(200).json({ message: "Request accepted successfully." });

    } catch (error) {
        console.error("Error accepting request:", error);
        return res.status(500).json({ error: "Failed to accept request." });
    }
});


router.post("/reject-request",verifyToken, async (req, res) => {
    const { requestId } = req.body;

    try {
        await db.collection("connectionRequests").doc(requestId).update({ status: "rejected" });

        return res.status(200).json({ message: "Request rejected successfully." });
    } catch (error) {
        console.error("Error rejecting request:", error);
        return res.status(500).json({ error: "Failed to reject request." });
    }
});

module.exports = router;
