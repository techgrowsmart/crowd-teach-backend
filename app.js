require("dotenv").config();
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const http = require("http");
const https = require("https");
const cassandra = require("cassandra-driver");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const verifyToken = require("./utils/verifyToken")
const connectMongoDB = require('./config/mongoDB');
const app = express();


// HTTP Server for Nginx proxy
const server = http.createServer(app);

// Initialize MongoDB connection
connectMongoDB().catch(err => {
  console.error('❌ Failed to connect to MongoDB:', err);
  process.exit(1);
});
// const options = {
//   key: fs.readFileSync('/etc/letsencrypt/live/teachnteachprimaryserver.spiraldevs.com/privkey.pem'),      // Private key
//   cert: fs.readFileSync('/etc/letsencrypt/live/teachnteachprimaryserver.spiraldevs.com/fullchain.pem'),  // Certificate chain
// };
// const server = https.createServer(options,app);
// Use real cert files placed by acme.sh
// const options = {
//   key: fs.readFileSync('/home/ec2-user/certs/privkey.pem'),
//   cert: fs.readFileSync('/home/ec2-user/certs/fullchain.pem')
// };
// const server = https.createServer(options, app);


const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
app.use(cors());
app.options('*', cors());

app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));
app.use(require('./requestLoggerTestGen.js'));

app.use("/uploads", express.static(uploadDir));


const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/gif"];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only JPEG, PNG, and GIF are allowed."));
    }
  },
});


const verifySubscription = async (req, res, next) => {
  try {
    const user_email = req.user?.email;
    
    if (!user_email) {
      return res.status(401).json({ 
        success: false, 
        message: "Authentication required" 
      });
    }

    const currentDate = new Date();
    
    const query = `SELECT * FROM user_subscriptions WHERE user_email = ? AND validity_date >= ? AND subscription_status = ? ALLOW FILTERING`;
    
    const result = await client.execute(query, [user_email, currentDate, 'active'], { prepare: true });
    
    if (result.rowLength === 0) {
      return res.status(403).json({ 
        success: false, 
        message: "Active subscription required",
        code: "SUBSCRIPTION_REQUIRED"
      });
    }

    next();
  } catch (error) {
    console.error("❌ Error verifying subscription:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Failed to verify subscription" 
    });
  }
};

const subscriptionRoutes = require('./routes/subscription.js');

const updateRoleRouter = require('./routes/update-user-role');
const signupRoutes = require("./routes/signup");
const authRoutes = require("./routes/auth");
const paymentRoutes = require('./routes/payments/paymentRoutes');
const {response} = require("express");
const messages = require("./routes/messages")
const walletBalence = require("./routes/getWalletBalence")
const getProfie = require("./routes/getProfile")
const connectionRequest =require("./routes/connectionRequest")
const addonClass = require("./routes/teachers/addonClass")
const myTutors = require("./routes/students/myTutors")
const {preloadTeachersToQueue}= require("./utils/preLoadTeachersQueue")
const redisClient= require("./config/redis")
const allboards = require("./routes/teachers/allboards")
const teachers = require("./routes/students/teachers")
const teacherInfoRoutes = require("./routes/students/teacherInfo.js"); //for teachers list
const valuesToselect = require("./routes/boardsValues")
const review = require('./routes/students/review')
const favoritesRoutes = require("./routes/favorites");
const {v4: uuidv4} = require("uuid");
const multerS3 = require("multer-s3");
const s3 = require("./config/s3");
const { createObjectCsvWriter } = require('csv-writer');
const classBoardData = JSON.parse(fs.readFileSync('./utils/allBoards.json', "utf8"));


// Add this with other route imports
const notificationRoutes = require('./routes/notification');
//routes for createSubject
const createSubject = require('./routes/teachers/createSubject.js');

app.use("/api", signupRoutes);
app.use("/api/auth", authRoutes);

app.use('/api', updateRoleRouter);
app.use("/api",getProfie)
app.use("/api",valuesToselect)
app.use("/api",teachers)
app.use("/api",allboards)
app.use("/api",messages)
app.use("/api",myTutors)
app.use('/api/payments', paymentRoutes);
app.use("/api",walletBalence)
app.use("/api",review)

app.use("/api",connectionRequest)
app.use("/api",addonClass)
//for create subject
app.use("/api", createSubject);

app.use("/api", notificationRoutes);
// for teacherInfoRoutes
app.use("/api", teacherInfoRoutes);
app.use("/api/subscriptions", subscriptionRoutes);

app.use("/api/favorites", favoritesRoutes);

// Posts/Thoughts routes - Using MongoDB
const postsRoutes = require('./routes/posts-mongo');
app.use("/api/posts", postsRoutes);

// const client = new cassandra.Client({
//
//   contactPoints: ['127.0.0.1'],
//   localDataCenter: 'datacenter1',
//   keyspace: "tutorial_app",
//
// });

const cloud = { secureConnectBundle: "./secure-connect-gogrowsmart.zip" };
const authProvider = new cassandra.auth.PlainTextAuthProvider('token', process.env['ASTRA_TOKEN']);
const credentials = {
  username: process.env.ASTRA_DB_USERNAME,
  password: process.env.ASTRA_DB_PASSWORD
};
const client = new cassandra.Client({ keyspace: process.env.ASTRA_DB_KEYSPACE, cloud, authProvider,  credentials});

async function createFavoriteTeachersTable() {
    try {
        const query = `
            CREATE TABLE IF NOT EXISTS favorite_teachers (
                student_id TEXT,
                teacher_id TEXT,
                created_at TIMESTAMP,
                teacher_data TEXT,  -- Store teacher data as JSON string
                PRIMARY KEY ((student_id), teacher_id)
            ) WITH default_time_to_live = 0;
        `;
        
        await client.execute(query);
        console.log("✅ favorite_teachers table created or already exists");
    } catch (error) {
        console.error("❌ Error creating favorite_teachers table:", error);
    }
}

// Add this with other table creation functions
const createNotificationsTable = async () => {
  try {
    await client.execute(`
      CREATE TABLE IF NOT EXISTS notifications (
        id uuid,
        sender_name text,
        avatar_url text,
        message text,
        created_at timestamp,
        target_role text,  -- 'student', 'teacher', or 'all'
        PRIMARY KEY ((target_role), created_at, id)
      ) WITH CLUSTERING ORDER BY (created_at DESC, id DESC)
    `);
    
    console.log('✅ Notifications table created successfully');
  } catch (error) {
    console.error('❌ Error creating notifications table:', error);
  }
};

const createNotificationReadStatusTable = async () => {
  try {
    await client.execute(`
      CREATE TABLE IF NOT EXISTS notification_read_status (
        user_email text,
        notification_id uuid,
        read_at timestamp,
        PRIMARY KEY (user_email, notification_id)
      )
    `);
    console.log('✅ Notification read status table created successfully');
  } catch (error) {
    console.error('❌ Error creating notification read status table:', error);
  }
};

// Call these functions after client initialization
createNotificationsTable();
createFavoriteTeachersTable();
createNotificationReadStatusTable();

const createStudentTable=async()=>{
  try {
    await client.execute(`
          CREATE TABLE IF NOT EXISTS student (
                                       email TEXT PRIMARY KEY,          
                                       name TEXT,
                                       date_of_birth TEXT,
                                       profileimage TEXT,             
                                       board TEXT,                      
                                       school_name TEXT,                 
                                       class_year TEXT,                      
                                       medium TEXT,                      
                                       phone_number TEXT,
                                       address TEXT,
                                       state TEXT,
                                       pincode TEXT,
                                       country TEXT
)
    `)
    console.log("✅ Student table created successfully");
  }catch (err){
    console.error("❌ Error creating Student table:", error.message);
  }
}

const createOtpTable = async () => {
  try {
    const query = `
      CREATE TABLE IF NOT EXISTS otp_table (
                               email text,
                               id uuid,
                               otp text,
                               expires_at timestamp,
                               PRIMARY KEY (email, id)
      );
    `;
    await client.execute(query);
    console.log("✅ otp table created successfully.");
  } catch (error) {
    console.error("❌ Error creating otp table:", error.message);
  }
}

const createUsersTable = async () => {
  try {
    const query = `
      CREATE TABLE IF NOT EXISTS users (
        id UUID,
        email TEXT,
        name TEXT,
        phonenumber TEXT,
        role TEXT,
        profileImage TEXT,
        status TEXT,
        created_at TIMESTAMP,
        PRIMARY KEY (id)
      )
    `;

    const indexQuery = `
      CREATE INDEX IF NOT EXISTS ON users(email);
    `;

    await client.execute(query);
    await client.execute(indexQuery);
    console.log("✅ users1 table created successfully.");
  } catch (error) {
    console.error("❌ Error creating users table:", error.message);
  }
};

const createSubjectsTable = async () => {
  try {
      const query = `
          CREATE TABLE IF NOT EXISTS subjects (
              subject_id UUID PRIMARY KEY,
              teacher_email TEXT,
              teaching_category TEXT,  -- 'Subject Teacher' or 'Skill Teacher'
              class_name TEXT,         -- For Subject: class name, For Skill: skill name
              class_category TEXT,     -- For Subject: class category, For Skill: 'Skill'
              description TEXT,
              board TEXT,              -- For Subject: board name, For Skill: 'Not Applicable'
              subject_title TEXT,      -- Subject name or Skill name
              status TEXT,
              created_at TIMESTAMP
          )
      `;
      await client.execute(query);
      console.log("✅ Subjects table created successfully");
  } catch (error) {
      console.error("❌ Error creating subjects table:", error.message);
  }
};

// Call this function after other table creations
createSubjectsTable();

createUsersTable()
const createTeacherTables = async () => {
  try {
    await client.execute(`
      CREATE TABLE IF NOT EXISTS teacher_info (
                                                id text,              
                                                email text,
                                                name text,
                                                tutions text,
                                                profilepic text,
                                                introduction text,
                                                PRIMARY KEY (id, email)
        )
    `);
    console.log("✅ teacher_info table created successfully");
  } catch (error) {
    console.error("❌ Error creating teacher_info table:", error.message);
  }
};
createStudentTable()

const createTeachersTable1 = async () => {
  try {
    const query = `
      CREATE TABLE IF NOT EXISTS teachers1 (
        
        email TEXT,
        name TEXT,
        profilePic TEXT,
        introduction TEXT,
        qualifications TEXT,
        category TEXT,
        tuitions TEXT,
        teachingMode TEXT,
        workExperience TEXT,
        university TEXT,
        isSpotlight BOOLEAN,
        PRIMARY KEY (email,name)
      );
    `;

    await client.execute(query);
    console.log("✅ teachers table created successfully.");
  } catch (error) {
    console.error("❌ Error creating teachers table:", error.message);
  }
};
createTeachersTable1()

const createMytutorsTable = async ()=>{
  try {
    const query=
        `
        CREATE TABLE my_tutors (
                           student_email TEXT,
                           teacher_email TEXT,
                           subject TEXT,
                           class_name TEXT,
                           booking_date TIMESTAMP,
                           PRIMARY KEY ((student_email), teacher_email)
);
      `
    console.log("✅ My tutors table created Successfully")
  }catch (e) {
    console.error("❌ Error creating My tutors table:", e.message);
  }
}
createMytutorsTable()

const createReviewTable = async () =>{
  try {
    const query = `
      CREATE TABLE IF NOT EXISTS teacher_reviews
      (
        teacher_email TEXT,
        review_id UUID,
        teacher_name TEXT,
        student_email TEXT,
        student_name TEXT,
        student_profile_pic TEXT,
        rating INT,
        selected_tags LIST<TEXT>,
        review_text TEXT,
        created_at TIMESTAMP,
        PRIMARY KEY(teacher_email,review_id)
        );
    `
    await client.execute(query)
    console.log("✅ Review table created successfully.")
  }catch (err){
    console.error("❌ Error creating Review table:",err.message)
  }
}
const tutorsRegistration = async () => {
  try {
    const query = `
      CREATE TABLE IF NOT EXISTS tutors (
                                          id UUID,
                                          email TEXT,
                                          full_name TEXT,
                                          phone_number TEXT,
                                          residentialAddress TEXT,
                                          state TEXT,
                                          country TEXT,
                                          pan TEXT,
                                          aadhar_front TEXT,  // Changed from aadhar
                                          aadhar_back TEXT,   // New column
                                          selfie_with_aadhar_front TEXT,
                                          selfie_with_aadhar_back TEXT,
                                          heighest_degree TEXT,
                                          specialization TEXT,
                                          experience TEXT,
                                          certification LIST<TEXT>,
                                          heighest_qualification_certification LIST<TEXT>,
                                          razorpay_account_id TEXT,
                                          PRIMARY KEY (id, email)
        );
    `;
    await client.execute(query);
    console.log("✅ Registration table created successfully.");
  } catch (err) {
    console.error("❌ Error creating Registration table:", err.message);
  }
};

createBankdetails= async ()=>{

    try {
      const query =`
CREATE TABLE IF NOT EXISTS bank_details (
  user_id UUID,
  email TEXT,
  account_number TEXT,
  ifsc_code TEXT,
  pan TEXT,
  bank_name TEXT,
  pincode TEXT,
  account_holder_name TEXT,
  created_at TIMESTAMP,
  PRIMARY KEY (user_id,email)
);
  `
      await  client.execute(query)
      console.log("✅ Bank details table Created successfully")
    }catch (error){
      console.error("❌ Error creating Bank details table",error.message)
    }
}

createBankdetails()
createReviewTable()
createTeacherTables();
tutorsRegistration();
createOtpTable();

const createWalletTables = async () => {
  try {
    await client.execute(`
      CREATE TABLE IF NOT EXISTS student_wallets (
        email text PRIMARY KEY,
        balance counter
      )
    `);

    await client.execute(`
      CREATE TABLE IF NOT EXISTS wallet_transactions (
        email text,
        transaction_id timeuuid,
        amount int,
        type text,
        order_id text,
        payment_id text,
        created_at timestamp,
        PRIMARY KEY (email, transaction_id)
      ) WITH CLUSTERING ORDER BY (transaction_id DESC)
    `);

    console.log('✅ Wallet tables created successfully');
  } catch (error) {
    console.error('❌ Error creating wallet tables:', error.message);
  }
};
createWalletTables();

const createBroadcastTables = async () => {
  try {
    await client.execute(`
      CREATE TABLE IF NOT EXISTS broadcast_table (
                                            teacherEmail text,
                                            className text,
                                            subject text,
                                            studentEmail text,
                                            teacherName text,
                                            teacherProfilePic text,
                                            studentName text,
                                            studentProfilePic text,
                                            date_time text,
                                            PRIMARY KEY (teacherEmail, className, subject, studentEmail)
        )
    `)

    console.log('✅ Broadcast tables created successfully');
  } catch (error) {
    console.error('❌ Error creating broadcast tables:', error);
  }
}
createBroadcastTables();

const createBroadcastMessagesTables = async () => {
  try {
    await client.execute(`
      CREATE TABLE IF NOT EXISTS broadcast_messages_table (
                                            teacherEmail text,
                                            className text,
                                            subject text,
                                            id timeuuid,
                                            studentEmails text,
                                            studentNames text,
                                            isBroadcast boolean,
                                            sender text,
                                            teacherName text,
                                            text text,
                                            time text,
                                            timestamp timestamp,
                                            PRIMARY KEY ((teacherEmail, className, subject), id)
        ) WITH CLUSTERING ORDER BY (id DESC);
    `)

    console.log('✅ Broadcast messages tables created successfully');
  } catch (error) {
    console.error('❌ Error creating broadcast messages tables:', error);
  }
}
createBroadcastMessagesTables();

// Protected booking route - requires subscription
app.post("/api/book-class", verifyToken, verifySubscription, async (req, res) => {
  try {
    const { 
      teacherEmail, 
      teacherName, 
      teacherProfilePic,
      selectedSubject, 
      selectedClass, 
      charge, 
      description 
    } = req.body;

    // This route will only execute if user has active subscription
    // Return success to allow frontend navigation
    res.status(200).json({
      success: true,
      message: "Subscription verified, proceeding to booking"
    });

  } catch (error) {
    console.error("❌ Error in book-class:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to process booking" 
    });
  }
});

app.post("/api/add-bank-details", verifyToken, async (req, res) => {
  try {
    const email = req.user.email;


    const getUserQuery = "SELECT id FROM users WHERE email = ? ALLOW FILTERING";
    const result = await client.execute(getUserQuery, [email], { prepare: true });

    if (result.rowLength === 0) {
      return res.status(404).json({ message: "❌ User not found" });
    }

    const userId = result.rows[0].id;

    const {
      account_number,
      ifsc_code,
      bank_name,
      account_holder_name,pan,pincode
    } = req.body;

    if (!account_number || !ifsc_code || !bank_name || !account_holder_name || !pan) {
      return res.status(400).json({ message: "❌ All bank details are required" });
    }

    const insertQuery = `
      INSERT INTO bank_details (user_id, email, account_number, ifsc_code, bank_name, account_holder_name,pan,pincode, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await client.execute(insertQuery, [
      userId,
      email,
      account_number,
      ifsc_code,
      bank_name,
      account_holder_name,
      pan,
      pincode,
      new Date()
    ], { prepare: true });

    return res.status(200).json({ message: "Your Documents Submitted successfully.Your Profile Under Review" });
  } catch (error) {
    console.error("❌ Error saving bank details:", error.message);
    return res.status(500).json({ message: "❌ Failed to save bank details" });
  }
});
const uploadImg = multer({
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

app.post(
    "/api/updateStudentProfile",
    verifyToken,
    uploadImg.single("profileimage"),
    async (req, res) => {
      try {
        const {
          email,
          name,
          dateofBirth,
          board,
          instituteName,
          classYear,
          preferredMedium,
          phone_number,
          fullAddress,
          stateName,
          pincode,
          country,

        } = req.body;
        console.log("📩 Received body:", req.body);
        console.log("📸 Received file:", req.file);

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
        const existingStudent = await client.execute(getStudentQuery, [email], { prepare: true });
        const existingData = existingStudent.rows[0] || {};

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
          board,
          instituteName,
          classYear,
          preferredMedium,
          phone_number,
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

app.post("/api/upload",verifyToken, (req, res) => {
  upload.single("file")(req, res, function (err) {
    if (err) {
      console.error("File upload error:", err);
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    console.log("File uploaded successfully:", req.file);
    const fileUrl = `http://${req.headers.host}/uploads/${req.file.filename}`;
    res.json({ url: fileUrl });
  });
});
const getClassId = (boardName, className, jsonData) => {
  for (const category of jsonData) {
    if (category.name === "Subject teacher") {
      for (const board of category.boards) {
        if (board.name === boardName) {
          for (const cls of board.classes) {
            if (cls.name === className) {
              return cls.id;
            }
          }
        }
      }
    }
  }

  return null;
};


const getSkillID = (skillName, jsonData) => {
  for (const category of jsonData) {
    if (category.name === "Skill teacher") {
      for (const skill of category.skills) {
        if (skill.name === skillName) {
          return skill.id;
        }
      }
    }
  }
  return null;
};
app.post("/api/teacherss",  upload.single("profileimage"), async (req, res) => {
  const {
    fullName,
    email,
    profilePic,
    introduction,
    qualifications,
    category,
    tuitions,
    teachingMode,
    workExperience,
    university,
  } = req.body;
console.log("Cate",req.body)
  if (!fullName || !email || !category) {
    return res.status(400).json({ error: "Full name, email, and category are required" });
  }

  if (!Array.isArray(qualifications) || qualifications.length === 0) {
    return res.status(400).json({ error: "At least one qualification is required" });
  }

  if (!Array.isArray(teachingMode) || teachingMode.length === 0) {
    return res.status(400).json({ error: "At least one teaching mode must be selected" });
  }

  if (!Array.isArray(tuitions) || tuitions.length === 0) {
    return res.status(400).json({ error: "At least one tuition subject must be added" });
  }

  try {
    const tuitionsWithIds = tuitions.map(tuition => {
      if (category === "Subject teacher") {
        return {
          ...tuition,
          classId: getClassId(tuition.board, tuition.class, classBoardData),
        };
      } else {
        return {
          ...tuition,
          skillId: getSkillID(tuition.skill, classBoardData),
        };
      }
    });

    const insertTeacherQuery = `
      INSERT INTO teachers1 (
        email,
        name,
        profilePic,
        introduction,
        qualifications,
        isspotlight,
        category,
        tuitions,
        teachingMode,
        workExperience,
        university
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const teacherParams = [
      email,
      fullName,
      profilePic || "",
      introduction || "",
      JSON.stringify(qualifications),
      false,
      category,
      JSON.stringify(tuitionsWithIds),
      JSON.stringify(teachingMode),
      workExperience || "",
      university || ""
    ];

    await client.execute(insertTeacherQuery, teacherParams, { prepare: true });


    const tuitionsByClass = {};

    for (const tuition of tuitionsWithIds) {
      const key = category === "Subject teacher" ? tuition.classId : tuition.skillId;
      console.log("key",key)
      const id = key || "unknown";

      if (!tuitionsByClass[id]) {
        tuitionsByClass[id] = [];
      }

      tuitionsByClass[id].push(tuition);
    }
    console.log("Data",tuitionsByClass)

    for (const id in tuitionsByClass) {
      const insertInfoQuery = `
        INSERT INTO teacher_info (
          id,
          email,
          name,
          tutions,
          profilePic,
          introduction
        ) VALUES (?, ?, ?, ?, ?, ?)
      `;

      const infoParams = [
        id,
        email,
        fullName,
        JSON.stringify(tuitionsByClass[id]),
        profilePic || "",
        introduction || "",
      ];

      await client.execute(insertInfoQuery, infoParams, { prepare: true });
    }

    res.status(200).json({ message: "Teacher data saved successfully" });
  } catch (error) {
    console.error("❌ Error saving teacher data:", error);
    res.status(500).json({ error: "Failed to save teacher data" });
  }
});



const uploadTeacher = multer({
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
app.post("/api/uploadTeacherimg", uploadTeacher.single("profileimage"), async (req, res) => {
  try {
    console.log("hitting upload teacher img")
    // console.log("🚀 req.body:", req.body);
    // console.log("📷 req.file:", req.file);
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


app.get("/api/student-wallet-balence",verifyToken, async (req, res) => {


  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const query = 'SELECT email, balance FROM student_wallets WHERE email = ?';
    const params = [email];

    const result = await client.execute(query, params, { prepare: true });

    if (result.rowLength === 0) {
      return res.status(404).json({ message: "Student not found" });
    }

    const student = result.rows[0];

    return res.json({
      email: student.email,
      walletBalance: student.balance
    });


  } catch (e) {
    console.error("Error fetching student wallet balance:", e);
    return res.status(500).json({ message: "Failed to fetch wallet balance" });
  }
});

app.post("/api/profile",verifyToken, async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "❌ Email is required" });
    }

    console.log(`🔍 Fetching profile for: ${email}`);

    const query = "SELECT * FROM users WHERE email = ? ALLOW FILTERING";
    const result = await client.execute(query, [email], { prepare: true });

    if (result.rowLength === 0) {
      return res.status(404).json({ message: "❌ User not found" });
    }
    const userProfile = result.rows[0];
    console.log("✅ User profile found:", userProfile);
    return res.status(200).json({ profile: userProfile });
  } catch (error) {
    console.error("❌ Error fetching profile:", error);
    return res.status(500).json({ message: `Failed to fetch profile: ${error.message}` });
  }
});


app.post('/api/review', async (req, res) => {
    const {
        teacherEmail,
        teacherName,
        studentEmail,
        studentName,
        studentProfilePic,
        rating,
        selectedTags,
        reviewText
    } = req.body;

    if (!teacherEmail || !studentEmail || !rating || !reviewText) {
        return res.status(400).json({ message: 'Missing required fields' });
    }

    const reviewId = uuidv4();
    const createdAt = new Date();

    const query = `
        INSERT INTO teacher_reviews (
            teacher_email, review_id, teacher_name,
            student_email, student_name, student_profile_pic,
            rating, selected_tags, review_text, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `;

    const params = [
        teacherEmail, reviewId, teacherName,
        studentEmail, studentName, studentProfilePic || '',
        rating, selectedTags, reviewText, createdAt
    ];

    try {
        await client.execute(query, params, { prepare: true });
        res.status(200).json({ message: 'Review submitted' });
    } catch (error) {
        console.error('Failed to insert review:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});


app.get('/review', async (req, res) => {
  console.log('📥 Received GET /review request with query:', req.query);
  const { email } = req.query;

  if (!email) {
    return res.status(400).json({ message: 'Email query param is required' });
  }

  const query = `SELECT * FROM teacher_reviews WHERE teacher_email = ? ALLOW FILTERING`;

  try {
    const result = await client.execute(query, [email], { prepare: true });
    res.status(200).json({ reviews: result.rows });
  } catch (error) {
    console.error('❌ Failed to fetch reviews:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.post("/api/messages/send", async (req, res) => {
  const { sender, recipient, text } = req.body;
  const chatId = [sender, recipient].sort().join("_");
console.log("chtId",chatId)
  await client.execute(
      "INSERT INTO messages (chat_id, sender, recipient, text, timestamp) VALUES (?, ?, ?, ?, toTimestamp(now()))",
      [chatId, sender, recipient, text]
  );

  res.json({ message: "Message sent" });
});

// Get bank details
app.get("/api/bank-details", verifyToken, async (req, res) => {
  try {
    const email = req.user.email;

    const getUserQuery = "SELECT id FROM users WHERE email = ? ALLOW FILTERING";
    const userResult = await client.execute(getUserQuery, [email], { prepare: true });

    if (userResult.rowLength === 0) {
      return res.status(404).json({ message: "❌ User not found" });
    }

    const userId = userResult.rows[0].id;

    const query = `
      SELECT account_number, ifsc_code, bank_name, account_holder_name, pan, pincode 
      FROM bank_details 
      WHERE user_id = ? AND email = ?
    `;

    const result = await client.execute(query, [userId, email], { prepare: true });

    if (result.rowLength === 0) {
      return res.status(404).json({ message: "❌ Bank details not found" });
    }

    const bankDetails = result.rows[0];
    
    return res.status(200).json({
      success: true,
      data: {
        accountNumber: bankDetails.account_number,
        ifscCode: bankDetails.ifsc_code,
        bankName: bankDetails.bank_name,
        accountHolderName: bankDetails.account_holder_name,
        pan: bankDetails.pan,
        pincode: bankDetails.pincode
      }
    });

  } catch (error) {
    console.error("❌ Error fetching bank details:", error.message);
    return res.status(500).json({ 
      success: false, 
      message: "❌ Failed to fetch bank details" 
    });
  }
});

// Update bank details
app.put("/api/update-bank-details", verifyToken, async (req, res) => {
  try {
    const email = req.user.email;

    const getUserQuery = "SELECT id FROM users WHERE email = ? ALLOW FILTERING";
    const userResult = await client.execute(getUserQuery, [email], { prepare: true });

    if (userResult.rowLength === 0) {
      return res.status(404).json({ message: "❌ User not found" });
    }

    const userId = userResult.rows[0].id;

    const {
      account_number,
      ifsc_code,
      bank_name,
      account_holder_name,
      pan,
      pincode
    } = req.body;

    if (!account_number || !ifsc_code || !bank_name || !account_holder_name || !pan) {
      return res.status(400).json({ message: "❌ All bank details are required" });
    }

    // Check if bank details already exist
    const checkQuery = "SELECT * FROM bank_details WHERE user_id = ? AND email = ?";
    const existingDetails = await client.execute(checkQuery, [userId, email], { prepare: true });

    let query;
    let params;

    if (existingDetails.rowLength > 0) {
      // Update existing record
      query = `
        UPDATE bank_details 
        SET account_number = ?, ifsc_code = ?, bank_name = ?, account_holder_name = ?, pan = ?, pincode = ?, created_at = ?
        WHERE user_id = ? AND email = ?
      `;
      params = [
        account_number,
        ifsc_code,
        bank_name,
        account_holder_name,
        pan,
        pincode,
        new Date(),
        userId,
        email
      ];
    } else {
      // Insert new record
      query = `
        INSERT INTO bank_details (user_id, email, account_number, ifsc_code, bank_name, account_holder_name, pan, pincode, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      params = [
        userId,
        email,
        account_number,
        ifsc_code,
        bank_name,
        account_holder_name,
        pan,
        pincode,
        new Date()
      ];
    }

    await client.execute(query, params, { prepare: true });

    return res.status(200).json({ 
      success: true,
      message: "✅ Bank details updated successfully" 
    });

  } catch (error) {
    console.error("❌ Error updating bank details:", error.message);
    return res.status(500).json({ 
      success: false, 
      message: "❌ Failed to update bank details" 
    });
  }
});


// Initial preload on server start
preloadTeachersToQueue().then(r => {});

// Endpoint to manually trigger teacher data preload
app.get("/api/preload-teachers", async (req, res) => {
    try {
        console.log("🔄 Manual teacher preload requested");
        await preloadTeachersToQueue();
        res.json({ success: true, message: "✅ Teacher data preloaded successfully" });
    } catch (error) {
        console.error("❌ Error in manual preload:", error);
        res.status(500).json({ success: false, message: "Failed to preload teacher data", error: error.message });
    }
});

app.get("/api/ping", (req, res) => {
  res.json({ message: "✅ Server is reachable from your device!" });
});
app.get("/", (req, res) => {
  res.json({ message: "✅ Server is reachable from your device!" });
});


const HOST = process.env.HOST || '127.0.0.1'
const PORT = process.env.PORT || 3000;
server.listen(PORT, HOST, () => console.log(`🚀 Server running on http://${HOST}:${PORT}`));


module.exports = app;
