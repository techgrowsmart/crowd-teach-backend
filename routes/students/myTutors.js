const express = require("express");
const router = express.Router();
const {db} = require("../../config/firebase");
const verifyToken = require("../../utils/verifyToken");
const client = require("../../config/db");



router.post("/add-tutor", verifyToken, async (req, res) => {
    const {
        studentEmail,
        teacherEmail,
        teacherName,
        subject,
        profilePic,
        className,
        studentName,
        studentProfilePic,
    } = req.body;

    // Validate profile pics
    if (!profilePic || !studentProfilePic) {
        return res.status(400).json({
            success: false,
            message: "Both teacher and student profile pictures are required.",
        });
    }

    try {
        const studentDocRef = db
            .collection("contacts")
            .doc(studentEmail)
            .collection("teachers")
            .doc(teacherEmail);

        await studentDocRef.set({
            teacherEmail,
            teacherName,
            teacherProfilePic: profilePic,
            subject,
            className,
            addedAt: new Date(),
        });

        const teacherDocRef = db
            .collection("contacts")
            .doc(teacherEmail)
            .collection("students")
            .doc(studentEmail);

        await teacherDocRef.set({
            studentEmail,
            studentName,
            studentProfilePic,
            className,
            addedAt: new Date(),
        });
        const query = `
            INSERT INTO broadcast_table (
              teacheremail, classname, subject, studentemail,
              teachername, teacherprofilepic, studentname, studentprofilepic, date_time
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?,?)
          `;

        const totalClasses = className.split(",")
        const totalSubjects = subject.split(",")
        const paramList = [];
        for (let i = 0; i < totalClasses.length; i++) {
                paramList.push([teacherEmail,
                totalClasses[i].trim(),
                totalSubjects[i].trim(),
                studentEmail,
                teacherName,
                profilePic,
                studentName,
                studentProfilePic,
                String(new Date().toLocaleDateString())
                ])
        }

        const params = [

        ];

        try {
            for (let i = 0; i < paramList.length; i++) {
                await client.execute(query, paramList[i], { prepare: true });
            }
        } catch (err) {
            console.error("❌ Error inserting contact:", err);
        }

        res.status(200).json({
            success: true,
            message: "Tutor and student contacts added successfully.",
        });
    } catch (err) {
        console.error("🔥 Failed to add tutor/student:", err);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

//Get all contacts for a student or teacher
router.post("/contacts", verifyToken, async (req, res) => {
    const { userEmail, type } = req.body;

    if (!userEmail || !type) {
        return res.status(400).json({ success: false, message: "Missing userEmail or type" });
    }

    try {
        const collectionType = type === "teacher" ? "students" : "teachers";

        const snapshot = await db
            .collection("contacts")
            .doc(userEmail)
            .collection(collectionType)
            .get();

        const contacts = snapshot.docs.map((doc) => doc.data());

        res.status(200).json({ success: true, contacts });
    } catch (err) {
        console.error("🔥 Failed to fetch contacts:", err);
        res.status(500).json({ success: false, message: "Server error" });
    }
});




module.exports = router;
