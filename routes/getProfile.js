const express = require("express");
const cassandraClient = require("../config/db");
const verifyToken = require("../utils/verifyToken");
const multer = require("multer");
const multerS3 = require("multer-s3");
const { s3 } = require("../config/s3");
const router = express.Router();

// Configure multer-s3 for automatic S3 uploads (same as signup.js)
const upload = multer({
    storage: multerS3({
        s3: s3,
        bucket: process.env.S3_BUCKET_NAME,
        metadata: (req, file, cb) => {
            cb(null, { fieldName: file.fieldname });
        },
        key: (req, file, cb) => {
            const fileName = `${Date.now()}-${file.originalname}`;
            cb(null, `certificates/${fileName}`);
        }
    })
});

// GET /api/tutor-certificate - Get tutor certificate data
router.get("/tutor-certificate", verifyToken, async (req, res) => {
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  try {
    const query = `SELECT certification, iscertified FROM tutors WHERE email = ? ALLOW FILTERING`;
    const result = await cassandraClient.execute(query, [email], { prepare: true });

    if (result.rowLength === 0) {
      return res.status(404).json({ error: "Tutor data not found" });
    }

    const tutorData = result.rows[0];
    // certification is a list<text>, get the first item if it exists
    const certificationList = tutorData.certification;
    const certificationUrl = Array.isArray(certificationList) && certificationList.length > 0
      ? certificationList[0]
      : null;

    res.json({
      success: true,
      certification: certificationUrl,
      isCertified: tutorData.iscertified || false
    });
  } catch (error) {
    console.error("❌ Error fetching tutor certificate:", error);
    res.status(500).json({ error: "Failed to fetch tutor certificate data" });
  }
});

// POST /api/tutor-certificate - Update tutor certificate data with file upload
router.post("/tutor-certificate", verifyToken, upload.single('certificate'), async (req, res) => {
  const { email } = req.body;

  console.log("📝 Certificate upload request received for email:", email);
  console.log("📁 File info:", req.file ? "File received" : "No file received");

  if (!email) {
    console.log("❌ Email is required");
    return res.status(400).json({ error: "Email is required" });
  }

  if (!req.file) {
    console.log("❌ Certificate file is required");
    return res.status(400).json({ error: "Certificate file is required" });
  }

  try {
    // Check if tutor exists and get their id (required for UPDATE)
    console.log("🔍 Checking if tutor exists for email:", email);
    const checkQuery = `SELECT id, email FROM tutors WHERE email = ? ALLOW FILTERING`;
    const checkResult = await cassandraClient.execute(checkQuery, [email], { prepare: true });

    if (checkResult.rowLength === 0) {
      console.log("❌ Tutor data not found for email:", email);
      return res.status(404).json({ error: "Tutor data not found" });
    }

    const tutor = checkResult.rows[0];
    const tutorId = tutor.id;
    console.log("✅ Tutor found:", email, "with ID:", tutorId);

    // Get S3 URL from uploaded file (multer-s3 handles the upload automatically)
    const certificationUrl = req.file.location;
    console.log("🔗 S3 URL from multer-s3:", certificationUrl);

    // Update certification - certification is stored as a list<text>
    // Need to include both id and email in WHERE clause (Cassandra partition key requirement)
    const certificationArray = [certificationUrl];
    console.log("📋 Updating certification in database with array:", certificationArray);
    
    const updateQuery = `UPDATE tutors SET certification = ? WHERE id = ? AND email = ?`;
    await cassandraClient.execute(updateQuery, [certificationArray, tutorId, email], { prepare: true });

    console.log("✅ Tutor certificate updated successfully for:", email);

    res.json({
      success: true,
      message: "Certificate updated successfully",
      certification: certificationUrl
    });
  } catch (error) {
    console.error("❌ Error updating tutor certificate:", error);
    console.error("❌ Error details:", error.message);
    console.error("❌ Error stack:", error.stack);
    res.status(500).json({ error: "Failed to update tutor certificate data", details: error.message });
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

        const teacherQuery = `
            SELECT email, name, profilepic, introduction, qualifications,
                category, tuitions, teachingmode, workexperience, university,
                pastuniversity, isspotlight, spotlight_type, subscription_expiry
            FROM teachers1
            WHERE email = ?
        `;
        const teacherResult = await cassandraClient.execute(teacherQuery, [email], { prepare: true });

        // ✅ ADD THIS: Get highest_degree and razorpay_account_id from tutors table
        const tutorQuery = "SELECT heighest_degree, razorpay_account_id, razorpay_account_status FROM tutors WHERE email = ? ALLOW FILTERING";
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
            university: "",
            pastUniversity: "", // ✅ ADD THIS FIELD
            location: "", // ✅ ADD THIS FIELD
            isSpotlight: false, // ✅ ADD THIS FIELD
            spotlightType: "",
            subscriptionExpiry: null
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
                university: teacher.university || "", // ✅ ADD THIS LINE
                pastUniversity: teacher.pastuniversity || "", // ✅ ADD THIS LINE
                location: "", // ✅ INITIALIZE EMPTY
                isspotlight: teacher.isspotlight || false, // ✅ ADD THIS LINE
                spotlightType: teacher.spotlight_type || "",
                subscriptionExpiry: teacher.subscription_expiry || null
            };
        }

        // ✅ ADD THIS: Set highest_degree and razorpay details from tutors table if available
        if (tutorResult.rowLength > 0) {
            const tutorData = tutorResult.rows[0];
            teacherData.heighest_degree = tutorData.heighest_degree || "";
            teacherData.razorpay_account_id = tutorData.razorpay_account_id || null;
            teacherData.razorpay_account_status = tutorData.razorpay_account_status || null;
        }


        // ✅ Check teacher_invoices for spotlight type - set to "Both" if both skill and subject purchased
        try {
            const invoicesQuery = `SELECT description FROM teacher_invoices WHERE teacher_email = ? AND status = 'paid' ALLOW FILTERING`;
            const invoicesResult = await cassandraClient.execute(invoicesQuery, [email], { prepare: true });
            
            if (invoicesResult.rowLength > 0) {
                const descriptions = invoicesResult.rows.map(row => row.description || '').join(' ').toLowerCase();
                const hasSkill = descriptions.includes('skill');
                const hasSubject = descriptions.includes('subject');
                
                if (hasSkill && hasSubject) {
                    teacherData.spotlightType = 'Both';
                    teacherData.isspotlight = true;
                }
            }
        } catch (invoiceError) {
            console.error("Error checking teacher invoices for spotlight type:", invoiceError);
            // Don't fail the request if invoice check fails
        }

        console.log("Teacher profile data:", JSON.stringify(teacherData, null, 2));
        return res.status(200).json(teacherData);

    } catch (error) {
        console.error("Error fetching teacher profile:", error);
        return res.status(500).json({ error: "Unable to fetch teacher profile" });
    }
});

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

module.exports = router;
