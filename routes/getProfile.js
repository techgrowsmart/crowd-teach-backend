const express = require("express");
const cassandraClient = require("../config/db");
const verifyToken = require("../utils/verifyToken");
const router = express.Router();


router.post("/sudentProfile", verifyToken, async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ error: "Email is required" });
    }

    const query = "SELECT * FROM student WHERE email = ?";
    const params = [email];

    try {
        const result = await cassandraClient.execute(query, params, { prepare: true });

        if (result.rowLength === 0) {
            return res.status(404).json({ error: "User not found" });
        }

        const user = result.rows[0];
        console.log(user)

        return res.status(200).json({
            email,
            name: user.name,
            profileimage: user.profileimage,
            fullAddress: user.address,
            classYear: user.class_year,
            country: user.country,
            dateOfBirth: user.date_of_birth,
            educationBoard: user.board,
            preferredMedium: user.medium,
            phone: user.phone_number,
            pincode: user.pincode,
            instituteName: user.school_name,
            stateName: user.state,
        });
    } catch (error) {
        console.error("Error fetching user profile:", error);
        return res.status(500).json({ error: "Unable to fetch user profile" });
    }
});


router.post("/userProfile", verifyToken, async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ error: "Email is required" });
    }

    const query = "SELECT id, created_at, profileimage, name, role, status FROM users WHERE email = ?";
    const params = [email];

    try {
        const result = await cassandraClient.execute(query, params, { prepare: true });

        if (result.rowLength === 0) {
            return res.status(404).json({ error: "User not found" });
        }

        const user = result.rows[0];

        return res.status(200).json({
            email,
            created_at: user.created_at,
            name: user.name,
            role: user.role,
            status: user.status || 'dormant', // Default to 'dormant' if status is null
            profileimage: user.profileimage,
        });

    } catch (error) {
        console.error("Error fetching user profile:", error);
        return res.status(500).json({ error: "Unable to fetch user profile" });
    }
});

router.post("/teacherProfile", verifyToken, async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ error: "Email is required" });
    }

    try {
        // First get basic user info from users table
        const userQuery = "SELECT id, name, role, profileimage, status, created_at FROM users WHERE email = ? ALLOW FILTERING";
        const userResult = await cassandraClient.execute(userQuery, [email], { prepare: true });

        if (userResult.rowLength === 0) {
            return res.status(404).json({ error: "Teacher not found" });
        }

        const user = userResult.rows[0];

        // Then get detailed teacher profile from teachers1 table
        const teacherQuery = `
            SELECT email, name, profilepic, introduction, qualifications,
                category, tuitions, teachingmode, workexperience, university
            FROM teachers1
            WHERE email = ?
        `;
        const teacherResult = await cassandraClient.execute(teacherQuery, [email], { prepare: true });

        // ✅ ADD THIS: Get highest_degree from tutors table
        const tutorQuery = "SELECT heighest_degree FROM tutors WHERE email = ? ALLOW FILTERING";
        const tutorResult = await cassandraClient.execute(tutorQuery, [email], { prepare: true });

        let teacherData = {
            email: user.email,
            name: user.name || "",
            role: user.role || "",
            profileimage: user.profileimage || "",
            profilePic: user.profileimage || "",
            status: user.status || 'dormant', // Include status with default fallback
            created_at: user.created_at, // Include created_at timestamp
            introduction: "",
            qualifications: [],
            category: "Subject teacher",
            tuitions: [],
            teachingMode: ["Online"],
            workExperience: "",
            heighest_degree: "", // ✅ ADD THIS FIELD
            university: ""
        };

        if (teacherResult.rowLength > 0) {
            const teacher = teacherResult.rows[0];

            // Parse JSON fields safely
            let qualifications = [];
            if (teacher.qualifications) {
                try {
                    qualifications = typeof teacher.qualifications === 'string'
                        ? JSON.parse(teacher.qualifications)
                        : teacher.qualifications;
                } catch (err) {
                    console.error("Failed to parse qualifications:", err);
                }
            }

            let tuitions = [];
            if (teacher.tuitions) {
                try {
                    tuitions = typeof teacher.tuitions === 'string'
                        ? JSON.parse(teacher.tuitions)
                        : teacher.tuitions;
                } catch (err) {
                    console.error("Failed to parse tuitions:", err);
                }
            }

            let teachingMode = ["Online"];
            if (teacher.teachingmode) {
                try {
                    teachingMode = typeof teacher.teachingmode === 'string'
                        ? JSON.parse(teacher.teachingmode)
                        : teacher.teachingmode;
                } catch (err) {
                    console.error("Failed to parse teaching mode:", err);
                }
            }

            teacherData = {
                email: teacher.email || user.email,
                name: teacher.name || user.name || "",
                role: user.role || "",
                profileimage: teacher.profilepic || user.profileimage || "",
                profilePic: teacher.profilepic || user.profileimage || "",
                status: user.status || 'dormant', // Include status with default fallback
                created_at: user.created_at, // Include created_at timestamp
                introduction: teacher.introduction || "",
                qualifications: Array.isArray(qualifications) ? qualifications : [],
                category: teacher.category || "Subject teacher",
                tuitions: Array.isArray(tuitions) ? tuitions : [],
                teachingMode: Array.isArray(teachingMode) ? teachingMode : ["Online"],
                workExperience: teacher.workexperience || "",
                heighest_degree: "", // ✅ INITIALIZE EMPTY
                    university: teacher.university || "" // ✅ ADD THIS LINE
            };
        }

        // ✅ ADD THIS: Set highest_degree from tutors table if available
        if (tutorResult.rowLength > 0) {
            teacherData.heighest_degree = tutorResult.rows[0].heighest_degree || "";
        }

        console.log("Teacher profile data:", JSON.stringify(teacherData, null, 2));
        return res.status(200).json(teacherData);

    } catch (error) {
        console.error("Error fetching teacher profile:", error);
        return res.status(500).json({ error: "Unable to fetch teacher profile" });
    }
});


module.exports = router;
