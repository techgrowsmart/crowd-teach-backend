const express = require("express")
const router = express.Router()
const client = require("../../config/db");
const verifyToken = require("../../utils/verifyToken")

// Add this route to get teacher's subjects
router.get("/teacher-subjects", verifyToken, async (req, res) => {
    try {
        const teacherEmail = req.user.email;
        const { email } = req.query;

        // Use the email from query or from token
        const targetEmail = email || teacherEmail;

        if (!targetEmail) {
            return res.status(400).json({ 
                message: "Email is required" 
            });
        }

        const query = `
            SELECT * FROM subjects 
            WHERE teacher_email = ? 
            ALLOW FILTERING
        `;

        const result = await client.execute(query, [targetEmail], { prepare: true });

        res.status(200).json({
            message: "Subjects fetched successfully",
            subjects: result.rows
        });

    } catch (error) {
        console.error("❌ Error fetching subjects:", error.message);
        res.status(500).json({ 
            message: "Failed to fetch subjects",
            error: error.message 
        });
    }
});

router.post("/createSubject", verifyToken, async (req, res) => {
    try {
        const { 
            teachingCategory, 
            className, 
            classCategory, 
            description, 
            board, 
            subjectTitle 
        } = req.body;

        const teacherEmail = req.user.email;

        // Validate required fields
        if (!teachingCategory || !subjectTitle) {
            return res.status(400).json({ 
                message: "Teaching category and title are required" 
            });
        }

        if (!['Subject Teacher', 'Skill Teacher'].includes(teachingCategory)) {
            return res.status(400).json({ 
                message: "Only Subject Teacher and Skill Teacher categories are supported" 
            });
        }

        // For Subject Teacher, require class name and board
        if (teachingCategory === 'Subject Teacher') {
            if (!className) {
                return res.status(400).json({ 
                    message: "Class name is required for Subject Teacher" 
                });
            }
            if (!board) {
                return res.status(400).json({ 
                    message: "Board is required for Subject Teacher" 
                });
            }
        }

        // For Skill Teacher, className is automatically set to 'Skill'
        // No additional validation needed beyond subjectTitle

        // Generate unique ID for the subject
        const subjectId = require('cassandra-driver').types.TimeUuid.now().toString();

        // Insert into database
        const query = `
            INSERT INTO subjects (
                subject_id,
                teacher_email,
                teaching_category,
                class_name,
                class_category,
                description,
                board,
                subject_title,
                status,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        const params = [
            subjectId,
            teacherEmail,
            teachingCategory,
            teachingCategory === 'Subject Teacher' ? className : 'Skill', // class_name
            teachingCategory === 'Subject Teacher' ? (classCategory || '') : subjectTitle, // class_category
            description || '',
            teachingCategory === 'Subject Teacher' ? board : 'Not Applicable', // board
            subjectTitle,
            'pending',
            new Date()
        ];

        await client.execute(query, params, { prepare: true });

        res.status(201).json({
            message: "Subject created successfully and submitted for verification",
            subjectId: subjectId,
            status: "pending"
        });

    } catch (error) {
        console.error("❌ Error creating subject:", error.message);
        res.status(500).json({ 
            message: "Failed to create subject",
            error: error.message 
        });
    }
});

module.exports = router;