const express = require("express");
const cassandraClient = require("../config/db");
const verifyToken = require("../utils/verifyToken");
const router = express.Router();


router.post("/studentProfile", verifyToken, async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ error: "Email is required" });
    }

    try {
        // First try to get from student table
        const studentQuery = "SELECT * FROM student WHERE email = ?";
        const studentResult = await cassandraClient.execute(studentQuery, [email], { prepare: true });

        if (studentResult.rowLength > 0) {
            const user = studentResult.rows[0];
            console.log('✅ Found student profile:', user.name);
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
        }

        // Fallback: if not in student table, get basic info from users table
        const userQuery = "SELECT name, profileimage, role FROM users WHERE email = ? ALLOW FILTERING";
        const userResult = await cassandraClient.execute(userQuery, [email], { prepare: true });

        if (userResult.rowLength === 0) {
            return res.status(404).json({ error: "User not found" });
        }

        const user = userResult.rows[0];
        console.log('✅ Found basic user profile (student profile not completed):', user.name);
        
        // Return basic profile with empty fields for uncompleted profile
        return res.status(200).json({
            email,
            name: user.name,
            profileimage: user.profileimage,
            fullAddress: "",
            classYear: "",
            country: "",
            dateOfBirth: "",
            educationBoard: "",
            preferredMedium: "",
            phone: "",
            pincode: "",
            instituteName: "",
            stateName: "",
        });
    } catch (error) {
        console.error("Error fetching user profile:", error);
        return res.status(500).json({ error: "Unable to fetch user profile" });
    }
});


// userProfile route moved to dedicated routes/userProfile.js to avoid conflicts

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
            ALLOW FILTERING
        `;
        const teacherResult = await cassandraClient.execute(teacherQuery, [email], { prepare: true });
        console.log("📊 getProfile: teachers1 query result rows:", teacherResult.rowLength);
        if (teacherResult.rowLength > 0) {
            console.log("📊 getProfile: Raw tuitions from DB:", teacherResult.rows[0].tuitions);
        }

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
            // Find the row with the most complete tuitions data
            let bestTeacher = teacherResult.rows[0];
            let bestTuitionCount = 0;
            
            for (const row of teacherResult.rows) {
                let tuitionCount = 0;
                if (row.tuitions) {
                    try {
                        const t = typeof row.tuitions === 'string' ? JSON.parse(row.tuitions) : row.tuitions;
                        if (Array.isArray(t)) {
                            tuitionCount = t.filter(item => item.class || item.subject || item.skill).length;
                        }
                    } catch (e) {
                        // ignore parse errors
                    }
                }
                console.log(`📊 getProfile: Row for "${row.name}" has ${tuitionCount} valid tuitions`);
                if (tuitionCount > bestTuitionCount) {
                    bestTuitionCount = tuitionCount;
                    bestTeacher = row;
                }
            }
            
            const teacher = bestTeacher;
            console.log(`📊 getProfile: Selected best row: "${teacher.name}" with ${bestTuitionCount} tuitions`);
            console.log("📊 getProfile: Raw teacher row:", JSON.stringify(teacher, null, 2));

            // Parse JSON fields safely
            let qualifications = [];
            if (teacher.qualifications) {
                try {
                    qualifications = typeof teacher.qualifications === 'string'
                        ? JSON.parse(teacher.qualifications)
                        : teacher.qualifications;
                    // Ensure qualifications is always an array
                    if (!Array.isArray(qualifications)) {
                        console.warn("Qualifications is not an array, defaulting to empty array");
                        qualifications = [];
                    }
                } catch (err) {
                    console.error("Failed to parse qualifications:", err);
                    qualifications = [];
                }
            }

            let tuitions = [];
            console.log("📊 getProfile: teacher.tuitions value:", teacher.tuitions);
            console.log("📊 getProfile: typeof teacher.tuitions:", typeof teacher.tuitions);
            if (teacher.tuitions) {
                try {
                    tuitions = typeof teacher.tuitions === 'string'
                        ? JSON.parse(teacher.tuitions)
                        : teacher.tuitions;
                    // Ensure tuitions is always an array
                    if (!Array.isArray(tuitions)) {
                        console.warn("Tuitions is not an array, defaulting to empty array");
                        tuitions = [];
                    }
                } catch (err) {
                    console.error("Failed to parse tuitions:", err);
                    tuitions = [];
                }
            }
            console.log("📊 getProfile: Parsed tuitions array:", JSON.stringify(tuitions));

            let teachingMode = ["Online"];
            if (teacher.teachingmode) {
                try {
                    teachingMode = typeof teacher.teachingmode === 'string'
                        ? JSON.parse(teacher.teachingmode)
                        : teacher.teachingmode;
                    // Ensure teachingMode is always an array
                    if (!Array.isArray(teachingMode) || teachingMode.length === 0) {
                        teachingMode = ["Online"];
                    }
                } catch (err) {
                    console.error("Failed to parse teaching mode:", err);
                    teachingMode = ["Online"];
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
