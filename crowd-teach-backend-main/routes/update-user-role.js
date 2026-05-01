const express = require("express");
const router = express.Router();
const client = require("../config/db"); // Import the database client
const multerS3 = require("multer-s3")
const multer = require("multer")
const s3 = require("./../config/s3")
const verifyToken = require('./../utils/verifyToken')
const upload = multer({
    storage: multerS3({
        s3: s3,
        bucket: process.env.S3_BUCKET_NAME,
        metadata: (req, file, cb) => {
            cb(null, { fieldName: file.fieldname });
        },
        key: (req, file, cb) => {
            const fileName = `${Date.now()}-${file.originalname}`;
            cb(null, `profile-images/${fileName}`);
        }
    })
});

router.post(
    "/updateStudentProfileWithImage",
    verifyToken,
    upload.single("profileimage"),
    async (req, res) => {
        console.log(1)
        try {
            const {
                email,
                name,
                dateofBirth,
                educationBoard,
                instituteName,
                classYear,
                preferredMedium,
                phone,
                fullAddress,
                stateName,
                pincode,
                country,

            } = req.body;
            console.log(2)
            if (!email || !name || !dateofBirth) {
                return res
                    .status(400)
                    .json({ message: "❌ Email, name, and DOB are required" });
            }

            if (!req.file || !req.file.location) {
                return res
                    .status(400)
                    .json({ message: "❌ Profile image is required" });
            }
            console.log(3)
            const profileImageUrl = req.file.location;

            const findUserQuery = "SELECT id FROM users WHERE email = ? ALLOW FILTERING";
            const userResult = await client.execute(findUserQuery, [email], { prepare: true });

            if (userResult.rowLength === 0) {
                return res.status(404).json({ message: `❌ No user found for email: ${email}` });
            }

            const userId = userResult.rows[0].id;
            console.log("Received body fields:", req.body);
            console.log("Received file:", req.file);

            console.log("User")
            const updateUserQuery = "UPDATE users SET profileimage = ?, name = ? WHERE id = ?";
            await client.execute(updateUserQuery, [profileImageUrl, name, userId], { prepare: true });
            const getStudentQuery = "SELECT * FROM student WHERE email = ? ALLOW FILTERING";

            const studentQuery = `
            INSERT INTO student (
                email, name, date_of_birth, board, school_name,
                class_year, medium, phone_number, address, state, pincode, country, profileimage
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

            const params = [
                email,
                name,
                dateofBirth,
                educationBoard,
                instituteName,
                classYear,
                preferredMedium,
                phone,
                fullAddress,
                stateName,
                pincode,
                country,
                profileImageUrl,
            ];

            await client.execute(studentQuery, params, { prepare: true });
            console.log("res",res.json)
            return res.status(200).json({
                message: "✅ Student profile updated successfully",
                imageUrl: profileImageUrl,
            });
        } catch (error) {
            console.error("❌ Error updating student profile:", error);
            return res.status(500).json({
                message: "❌ Internal Server Error",
                error: error.message,
            });
        }
    }
);

router.post(
    "/updateStudentProfile",
    verifyToken,
    async (req, res) => {
        console.log(1)
        try {
            const {
                email,
                name,
                dateofBirth,
                educationBoard,
                instituteName,
                classYear,
                preferredMedium,
                phone,
                fullAddress,
                stateName,
                pincode,
                country,

            } = req.body;
            console.log(2)
            if (!email || !name || !dateofBirth) {
                return res
                    .status(400)
                    .json({ message: "❌ Email, name, and DOB are required" });
            }
            console.log(3)

            const findUserQuery = "SELECT id FROM users WHERE email = ? ALLOW FILTERING";
            const userResult = await client.execute(findUserQuery, [email], { prepare: true });

            if (userResult.rowLength === 0) {
                return res.status(404).json({ message: `❌ No user found for email: ${email}` });
            }

            const userId = userResult.rows[0].id;
            console.log("Received body fields:", req.body);

            console.log("User")
            const studentQuery = `
            INSERT INTO student (
                email, name, date_of_birth, board, school_name,
                class_year, medium, phone_number, address, state, pincode, country
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

            const params = [
                email,
                name,
                dateofBirth,
                educationBoard,
                instituteName,
                classYear,
                preferredMedium,
                phone,
                fullAddress,
                stateName,
                pincode,
                country
            ];

            await client.execute(studentQuery, params, { prepare: true });
            console.log("res",res.json)
            return res.status(200).json({
                message: "✅ Student profile updated successfully"
            });

        } catch (error) {
            console.error("❌ Error updating student profile:", error);
            return res.status(500).json({
                message: "❌ Internal Server Error",
                error: error.message,
            });
        }
    }
);
router.post("/update-role", async (req, res) => {
    try {
        const { email, role } = req.body;

        if (!email || !role) {
            return res.status(400).json({ message: "❌ Email and role are required" });
        }

        console.log(`Attempting to update role for: ${email} to: ${role}`);

        const findUserQuery = "SELECT * FROM users WHERE email = ? ALLOW FILTERING";
        const userResult = await client.execute(findUserQuery, [email], { prepare: true });

        if (userResult.rowLength === 0) {
            return res.status(404).json({ message: "❌ User not found" });
        }

        const userId = userResult.rows[0].id;
        console.log(`Found user with ID: ${userId}`);


        let status = null;
        if (role === "student") {
            status = "active";
            const studentProfileQuery = `INSERT INTO student (email,name,phone_number) VALUES (?,?,?)`;
            const studentProfileParams = [email,userResult.rows[0].name,userResult.rows[0].phonenumber];
            await client.execute(studentProfileQuery, studentProfileParams, { prepare: true });
        } else if (role === "teacher") {
            status = "dormant";
        }


        const updateQuery = "UPDATE users SET role = ?, status = ? WHERE id = ?";
        const updateParams = [role, status, userId];

        await client.execute(updateQuery, updateParams, { prepare: true });

        console.log(`✅ Successfully updated role and status for user with ID: ${userId}`);

        return res.json({ message: "✅ User role and status updated successfully" });
    } catch (error) {
        console.error("❌ Error updating user role:", error);
        return res.status(500).json({ message: `Failed to update role: ${error.message}` });
    }
});


router.post("/update-profile",verifyToken, upload.single("profileimage"), async (req, res) => {
    try {
        const { email, name,address,board,class_year,country,date_of_birth,education_level,medium,phone_number,pincode,school_name,state } = req.body;

        if (!email || !name) {
            return res.status(400).json({ message: "❌ Email and name are required" });
        }

        if (!req.file || !req.file.location) {
            return res.status(400).json({ message: "❌ Profile image is required" });
        }

        const profileImageUrl = req.file.location;

        console.log(`🔄 Updating profile for ${email}`);


        const findUserQuery = "SELECT id FROM users WHERE email = ? ALLOW FILTERING";
        const result = await client.execute(findUserQuery, [email], { prepare: true });

        if (result.rowLength === 0) {
            return res.status(404).json({ message: `❌ No user found with email: ${email}` });
        }

        const userId = result.rows[0].id;


        const updateQuery = "UPDATE users SET profileimage = ?, name = ? WHERE id = ?";
        const updateParams = [profileImageUrl, name, userId];

        await client.execute(updateQuery, updateParams, { prepare: true });

        const studentQuerry=`
               INSERT INTO student (
          email, name, date_of_birth, education_level, board, school_name,
          class_year, medium, phone_number, address, state, pincode, country,profileImage
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
        const params =[
            name,email,date_of_birth,education_level,board,school_name,class_year,medium,phone_number,
            address,state,pincode,country,profileImageUrl
        ]
        console.log("1234")
        await client.execute(studentQuerry,params,{prepare:true})
        console.log(`✅ Profile updated for user ID: ${userId}`);

        return res.status(200).json({ message: "✅ Profile updated successfully", imageUrl: profileImageUrl });
    } catch (error) {
        console.error("❌ Error updating profile:", error);
        return res.status(500).json({ message: `Failed to update profile: ${error.message}` });
    }
});


router.post("/upload-profile-img", upload.single("profileimage"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: "No image uploaded" });
        }

        const { email, name } = req.body;
        const profileImageUrl = req.file.location;

        console.log(`🔄 Updating profile for ${email}`);


        const findUserQuery = "SELECT id FROM users WHERE email = ? ALLOW FILTERING";
        const result = await client.execute(findUserQuery, [email], { prepare: true });

        if (result.rowLength === 0) {
            return res.status(404).json({ message: `❌ No user found with email: ${email}` });
        }

        const userId = result.rows[0].id;
        console.log("User ID",userId)

        const updateQuery = "UPDATE users SET profileimage = ?, name = ? WHERE id = ?";
        const updateParams = [profileImageUrl, name, userId];

        await client.execute(updateQuery, updateParams, { prepare: true });

        const teacherProfile = "UPDATE teachers1 SET profilepic = ? WHERE email = ? AND name = ?";

        const updateParamsTeachers = [profileImageUrl,email,name];

        await  client.execute(teacherProfile,updateParamsTeachers,{prepare:true})
        console.log("123245566777888")
        return res.status(200).json({
            message: "✅ Profile image uploaded successfully",
            imageUrl: req.file.location,
            email,
            name,
        });
    } catch (err) {
        console.error("❌ Upload error:", err);
        res.status(500).json({ message: "Server error while uploading image" });
    }
});


module.exports = router;