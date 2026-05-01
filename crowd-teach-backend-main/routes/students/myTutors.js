const express = require("express");
const router = express.Router();
const {db} = require("../../config/firebase");
const verifyToken = require("../../utils/verifyToken");
const client = require("../../config/db");



// Default profile pictures
const DEFAULT_TEACHER_PROFILE_PIC = "https://cdn-icons-png.flaticon.com/512/4140/4140047.png"; // Female teacher avatar
const DEFAULT_STUDENT_PROFILE_PIC = "https://cdn-icons-png.flaticon.com/512/4140/4140048.png"; // Student/child avatar

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

    // Use default profile pics if not provided
    const finalTeacherProfilePic = profilePic || DEFAULT_TEACHER_PROFILE_PIC;
    const finalStudentProfilePic = studentProfilePic || DEFAULT_STUDENT_PROFILE_PIC;

    try {
        const studentDocRef = db
            .collection("contacts")
            .doc(studentEmail)
            .collection("teachers")
            .doc(teacherEmail);

        await studentDocRef.set({
            teacherEmail,
            teacherName,
            teacherProfilePic: finalTeacherProfilePic,
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
            studentProfilePic: finalStudentProfilePic,
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
                finalTeacherProfilePic,
                studentName,
                finalStudentProfilePic,
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

//Get all contacts for a student or teacher (Firebase-based - deprecated, use /api/contacts instead)
router.post("/firebase-contacts", verifyToken, async (req, res) => {
    const { userEmail, type } = req.body;

    if (!userEmail || !type) {
        return res.status(400).json({ success: false, message: "Missing userEmail or type" });
    }

    try {
        // Check if Firebase is properly initialized
        if (!db || typeof db.collection !== 'function') {
            console.log('⚠️ Firebase not initialized, returning empty contacts');
            return res.status(200).json({ success: true, contacts: [] });
        }
        
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
        // Return empty contacts instead of 500 error
        res.status(200).json({ success: true, contacts: [] });
    }
});




module.exports = router;
