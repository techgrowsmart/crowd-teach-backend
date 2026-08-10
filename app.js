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
const { encrypt, decrypt } = require("./utils/encryption");
const { syncProfileImageToUsers } = require("./utils/syncProfileImage");
const connectMongoDB = require('./config/mongoDB');
const app = express();
const axios = require('axios');

// Import optimizations
// const rateLimiter = require('./middleware/rateLimiter'); // Disabled rate limiting
const timeout = require('./middleware/timeout');

// Apply global middleware
// app.use(rateLimiter.generalLimiter); // Disabled rate limiting
app.use(timeout.requestTimeout(30000)); // 30 second timeout

// CORS configuration - Production ready for portal.gogrowsmart.com
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    // Allow localhost for development (any port)
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return callback(null, true);
    }
    
    // Allow local network IPs for mobile development
    if (origin.includes('192.168.') || origin.includes('10.') || origin.includes('172.')) {
      return callback(null, true);
    }
    
    // Allow Expo Go app
    if (origin.includes('exp://') || origin.includes('expo://')) {
      return callback(null, true);
    }
    
    // Allow all gogrowsmart.com subdomains (production)
    if (origin.includes('gogrowsmart.com') || 
        origin.endsWith('.gogrowsmart.com')) {
      return callback(null, true);
    }
    
    // Allow vercel.app domains for Vercel deployments
    if (origin.includes('vercel.app') || 
        origin.endsWith('.vercel.app')) {
      return callback(null, true);
    }
    
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'X-Test-User'],
  credentials: true,
  maxAge: 86400,
  preflightContinue: false,
  optionsSuccessStatus: 204
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// Initialize MongoDB connection
connectMongoDB().catch(err => {
  console.error('❌ Failed to connect to MongoDB:', err);
  if (process.env.SKIP_MONGO !== 'true') {
    process.exit(1);
  }
});

// Production-ready SSL configuration
let httpServer;

// Check if we're in production and have SSL certificates
if (process.env.NODE_ENV === 'production' && fs.existsSync('./certs/privkey.pem') && fs.existsSync('./certs/fullchain.pem')) {
  const options = {
    key: fs.readFileSync('./certs/privkey.pem'),
    cert: fs.readFileSync('./certs/fullchain.pem')
  };
  httpServer = https.createServer(options, app);
  console.log('🔒 HTTPS server configured with SSL certificates');
} else {
  httpServer = http.createServer(app);
  if (process.env.NODE_ENV === 'production') {
    console.log('⚠️  Production mode but no SSL certificates found, falling back to HTTP');
  } else {
    console.log('🔓 Development mode: HTTP server');
  }
}

// Initialize Socket.io
const { initSocket } = require('./socket');
const io = initSocket(httpServer);
console.log('📡 Socket.io initialized for real-time communication');

const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));
// app.use(require('./requestLoggerTestGen.js')); // Test file - not in production

// Static file serving with CORS headers for cross-origin image loading
app.use("/uploads", (req, res, next) => {
  // Add CORS headers for static files
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
}, express.static(uploadDir, {
  maxAge: '1d', // Cache for 1 day
  etag: true,
  lastModified: true,
  setHeaders: (res, path) => {
    // Set proper content-type for images
    if (path.endsWith('.png')) {
      res.setHeader('Content-Type', 'image/png');
    } else if (path.endsWith('.jpg') || path.endsWith('.jpeg')) {
      res.setHeader('Content-Type', 'image/jpeg');
    } else if (path.endsWith('.gif')) {
      res.setHeader('Content-Type', 'image/gif');
    }
  }
}));


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

// const subscriptionRoutes = require('./routes/subscription.js');
const billingRoutes = require('./routes/billing');

const updateRoleRouter = require('./routes/update-user-role');
const signupRoutes = require("./routes/signup");
const authRoutes = require("./routes/auth");
const paymentRoutes = require('./routes/payments/paymentRoutes');
const {response} = require("express");
const messages = require("./routes/messages")
const broadcastRoutes = require("./routes/broadcast.js")
const getProfie = require("./routes/getProfile")
const connectionRequest =require("./routes/connectionRequest")
const addonClass = require("./routes/teachers/addonClass")
const updateTuitions = require("./routes/teachers/updateTuitions")
const myTutors = require("./routes/students/myTutors")
const {preloadTeachersToQueue}= require("./utils/preLoadTeachersQueue")
const redisClient= require("./config/redis")
const allboards = require("./routes/teachers/allboards")
const teachers = require("./routes/students/teachers")
const teacherInfoRoutes = require("./routes/students/teacherInfo.js"); //for teachers list
const valuesToselect = require("./routes/boardsValues")
const favoritesRoutes = require("./routes/favorites");
const testAuthRoutes = require('./routes/test-auth');
const {v4: uuidv4} = require("uuid");
const multerS3 = require("multer-s3");
const { s3 } = require("./config/s3");
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
//for create subject - register before messages to prevent route collision
app.use("/api", createSubject);
app.use("/api/messages", messages)

// Additional chat endpoints (contacts, etc.)
const chatRoutes = require('./routes/chat');
app.use("/api/chat", chatRoutes);
app.use("/api/broadcast", broadcastRoutes)
app.use("/api",myTutors)
app.use('/api/payments', paymentRoutes);

app.use("/api",connectionRequest)
app.use("/api",addonClass)
app.use("/api",updateTuitions)
app.use("/api", notificationRoutes);
// for teacherInfoRoutes
app.use("/api", teacherInfoRoutes);
// app.use("/api/subscriptions", subscriptionRoutes);
// app.use("/api/billing", subscriptionRoutes);
app.use("/api/billing", billingRoutes);

app.use("/api/favorites", favoritesRoutes);
app.use("/api/test-auth", testAuthRoutes);

// Referral routes
const referralRoutes = require('./routes/referral');
app.use('/api', referralRoutes);

// Posts/Thoughts routes - Using MongoDB
const postsRoutes = require('./routes/posts-mongo');
app.use("/api/posts", postsRoutes);

// User profile routes - Using AstraDB
const userProfileRoutes = require('./routes/userProfile');
app.use("/api/userProfile", userProfileRoutes);

// Missing API endpoints for production
const teacherReviewsRoutes = require("./routes/teacher-reviews");
app.use("/api", teacherReviewsRoutes);

const enrollmentDataRoutes = require("./routes/enrollment-data");
app.use("/api", enrollmentDataRoutes);

// Admin dashboard routes
const adminRoutes = require("./routes/admin");
app.use("/api/admin", adminRoutes);

// Booking routes for real-time class booking requests
const { router: bookingRoutes, initBookingTable } = require('./routes/booking');
app.use("/api/bookings", bookingRoutes);

// Teacher enrolled students route
const teacherEnrolledStudentsRoutes = require('./routes/teacher-enrolled-students');
app.use("/api/teacher", teacherEnrolledStudentsRoutes);

// Account deletion request route (landing page form)
const deleteAccountRequestRoutes = require('./routes/delete-account-request');
app.use('/api', deleteAccountRequestRoutes);

// const client = new cassandra.Client({
//
//   contactPoints: ['127.0.0.1'],
//   localDataCenter: 'datacenter1',
//   keyspace: "tutorial_app",
//
// });

// Cassandra client is now initialized in config/db.js
const client = require('./config/db');

// Initialize booking table on server startup (non-blocking)
setTimeout(() => {
  initBookingTable(client).catch(err => {
    console.error('❌ Failed to initialize booking table:', err);
  });
}, 1000);

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
        target_user_email text,
        target_type text,
        PRIMARY KEY (id, created_at)
      ) WITH CLUSTERING ORDER BY (created_at DESC)
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

// Call these functions after client initialization (non-blocking)
setTimeout(() => createNotificationsTable().catch(err => console.error('❌ Notifications table creation failed:', err.message)), 2000);
setTimeout(() => createFavoriteTeachersTable().catch(err => console.error('❌ Favorite teachers table creation failed:', err.message)), 3000);
setTimeout(() => createNotificationReadStatusTable().catch(err => console.error('❌ Notification read status table creation failed:', err.message)), 4000);

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
    console.error("❌ Error creating Student table:", err.message);
  }
}

const createStudentsTable=async()=>{
  try {
    await client.execute(`
          CREATE TABLE IF NOT EXISTS students (
                                       email TEXT PRIMARY KEY,          
                                       name TEXT,
                                       profilepic TEXT,
                                       profile_pic TEXT,
                                       profileImage TEXT,
                                       profile_image TEXT,
                                       profileimage TEXT
)
    `)
    console.log("✅ Students table created successfully");
  }catch (err){
    console.error("❌ Error creating Students table:", err.message);
  }
};

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

// Call this function after other table creations (non-blocking)
setTimeout(() => createSubjectsTable().catch(err => console.error('❌ Subjects table creation failed:', err.message)), 15000);
setTimeout(() => createUsersTable().catch(err => console.error('❌ Users table creation failed:', err.message)), 16000);

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

    // Create secondary index on email for efficient querying without ALLOW FILTERING
    try {
      await client.execute(`CREATE INDEX IF NOT EXISTS teacher_info_email_idx ON teacher_info (email)`);
      console.log("✅ teacher_info_email_idx index created successfully");
    } catch (indexError) {
      console.warn("⚠️ Failed to create teacher_info_email_idx index:", indexError.message);
    }
  } catch (error) {
    console.error("❌ Error creating teacher_info table:", error.message);
  }
};
setTimeout(() => createStudentTable().catch(err => console.error('❌ Student table creation failed:', err.message)), 5000);
setTimeout(() => createStudentsTable().catch(err => console.error('❌ Students table creation failed:', err.message)), 6000);

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
        pastUniversity TEXT,
        isspotlight BOOLEAN,
        PRIMARY KEY (email,name)
      );
    `;

    await client.execute(query);
    console.log("✅ teachers table created successfully.");
  } catch (error) {
    console.error("❌ Error creating teachers table:", error.message);
  }
};
setTimeout(() => createTeachersTable1().catch(err => console.error('❌ Teachers table1 creation failed:', err.message)), 17000);

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
setTimeout(() => createMytutorsTable().catch(err => console.error('❌ My tutors table creation failed:', err.message)), 18000);

const tutorsRegistration = async () => {
  try {
    const query = `
      CREATE TABLE IF NOT EXISTS tutors (
        id UUID,
        email TEXT,
        full_name TEXT,
        phone_number TEXT,
        residentialaddress TEXT,
        state TEXT,
        country TEXT,
        heighest_degree TEXT,
        specialization TEXT,
        experience TEXT,
        razorpay_account_id TEXT,
        razorpay_account_status TEXT,
        PRIMARY KEY (id, email)
      );
    `;
    await client.execute(query);
    console.log("✅ Tutors table created successfully.");
  } catch (err) {
    console.error("❌ Error creating tutors table:", err.message);
  }
};

// Add missing columns to existing tutors table (for Razorpay flow)
const addMissingColumnsToTutors = async () => {
  const columnsToAdd = [
    { name: 'razorpay_account_id', type: 'TEXT' },
    { name: 'razorpay_account_status', type: 'TEXT' },
  ];

  for (const col of columnsToAdd) {
    try {
      await client.execute(`ALTER TABLE tutors ADD ${col.name} ${col.type};`);
      console.log(`✅ Added ${col.name} column to tutors table`);
    } catch (err) {
      if (err.message.includes('already') || err.message.includes('existing') || err.message.includes('conflicts')) {
        console.log(`✅ ${col.name} column already exists in tutors table`);
      } else {
        console.error(`❌ Error adding ${col.name} to tutors table:`, err.message);
      }
    }
  }
};

setTimeout(() => createTeacherTables().catch(err => console.error('❌ Teacher tables creation failed:', err.message)), 6000);
setTimeout(() => tutorsRegistration().catch(err => console.error('❌ Tutors registration failed:', err.message)), 7000);
setTimeout(() => createOtpTable().catch(err => console.error('❌ OTP table creation failed:', err.message)), 9000);


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
setTimeout(() => createBroadcastTables().catch(err => console.error('❌ Broadcast tables creation failed:', err.message)), 13000);

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
setTimeout(() => createBroadcastMessagesTables().catch(err => console.error('❌ Broadcast messages tables creation failed:', err.message)), 14000);

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

// QR Code image upload to S3 (DPDP 2023 Compliant)
const uploadQrCode = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.S3_BUCKET_NAME,
    metadata: (req, file, cb) => {
      cb(null, { fieldName: file.fieldname });
    },
    key: (req, file, cb) => {
      const fileName = `qr-${Date.now()}-${file.originalname}`;
      cb(null, `qr-codes/${fileName}`);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max for QR codes
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, and WebP images are allowed'), false);
    }
  }
});

app.post("/api/upload-qr-code", verifyToken, uploadQrCode.single("qrcode"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: "No QR code image uploaded" });
    }
    const qrCodeUrl = req.file.location;
    console.log(`✅ QR code uploaded for ${req.user.email}: ${qrCodeUrl}`);
    return res.status(200).json({
      success: true,
      message: "QR code uploaded successfully",
      qrCodeUrl: qrCodeUrl
    });
  } catch (error) {
    console.error("❌ QR code upload error:", error);
    return res.status(500).json({ success: false, message: "Failed to upload QR code" });
  }
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

// Chat image upload — stored in S3 (chat-images/) to avoid EC2 disk usage and make URLs permanent
const chatImageUpload = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.S3_BUCKET_NAME,
    metadata: (req, file, cb) => {
      cb(null, { fieldName: file.fieldname, uploadedBy: req.user?.email || 'unknown' });
    },
    key: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, `chat-images/${Date.now()}-${Math.random().toString(36).substr(2, 6)}${ext}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max for chat images
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, GIF and WebP are allowed.'));
    }
  }
});

app.post("/api/upload", verifyToken, chatImageUpload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }
  const fileUrl = req.file.location; // S3 public URL
  console.log(`✅ Chat image uploaded to S3: ${fileUrl}`);
  res.json({ url: fileUrl });
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

// Get university+year ID for Universities board entries
const getUniversityYearId = (universityName, yearName, jsonData) => {
  for (const category of jsonData) {
    if (category.name === "Subject teacher") {
      for (const board of category.boards) {
        if (board.name === "Universities") {
          for (const uni of board.universities || []) {
            if (uni.name === universityName) {
              for (const year of uni.years || []) {
                if (year.name === yearName) {
                  return `${uni.id}_${year.id}`;
                }
              }
            }
          }
        }
      }
    }
  }
  // Fallback: create a safe ID from university and year names
  if (universityName && yearName) {
    const safeUni = universityName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    const safeYear = yearName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    return `uni_${safeUni}_${safeYear}`;
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
    pastUniversity,
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

  try {
    const tuitionsWithIds = tuitions.map(tuition => {
      if (category === "Subject teacher") {
        // For Universities board, use university+year ID instead of classId
        if (tuition.board === 'Universities') {
          const uniYearId = getUniversityYearId(tuition.university, tuition.year, classBoardData);
          return {
            ...tuition,
            classId: uniYearId, // Use university_year ID as the grouping key
          };
        } else {
          return {
            ...tuition,
            classId: getClassId(tuition.board, tuition.class, classBoardData),
          };
        }
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
        university,
        pastUniversity
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      university || "",
      pastUniversity || ""
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

    await syncProfileImageToUsers(email, profilePic || "");

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
    // console.log("✅ User profile found:", userProfile);
    return res.status(200).json({ profile: userProfile });
  } catch (error) {
    console.error("❌ Error fetching profile:", error);
    return res.status(500).json({ message: `Failed to fetch profile: ${error.message}` });
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
app.get("/health", (req, res) => {
  res.status(200).json({ status: "healthy", uptime: process.uptime() });
});

// GET /api/teacherdetails/:email - Get teacher details by email
app.get("/api/teacherdetails/:email", verifyToken, async (req, res) => {
  try {
    const targetEmail = decodeURIComponent(req.params.email);
    const requestingUserEmail = req.user.email;
    
    console.log(`👨‍🏫 Fetching teacher details for: ${targetEmail} by: ${requestingUserEmail}`);
    
    // Only allow users to fetch their own teacher details or students to fetch teacher details
    if (targetEmail !== requestingUserEmail && req.user.role !== 'student') {
      return res.status(403).json({ 
        success: false, 
        message: "Access denied" 
      });
    }
    
    // Try to fetch from MongoDB TeacherDetails first
    const { TeacherOnboarding } = require('./models/TeacherDetails');
    let teacherDetails = null;
    
    try {
      teacherDetails = await TeacherOnboarding.findOne({ teacher_id: targetEmail });
      
      if (teacherDetails) {
        return res.status(200).json({
          success: true,
          teacher: {
            name: teacherDetails.name || targetEmail.split('@')[0],
            email: targetEmail,
            profilePic: teacherDetails.profileimage || null,
            subject: teacherDetails.subject || 'Subject',
            className: teacherDetails.class_name || 'Class'
          }
        });
      }
    } catch (mongoError) {
      console.log('MongoDB not available, trying Cassandra...');
    }
    
    // Fallback to Cassandra users table
    try {
      const query = `
        SELECT name, profileimage FROM users 
        WHERE email = ? LIMIT 1
        ALLOW FILTERING
      `;
      const result = await client.execute(query, [targetEmail], { prepare: true });
      
      if (result.rows && result.rows.length > 0) {
        const teacherRow = result.rows[0];
        return res.status(200).json({
          success: true,
          teacher: {
            name: teacherRow.name || targetEmail.split('@')[0],
            email: targetEmail,
            profilePic: teacherRow.profilepic || null,
            subject: 'Subject',
            className: 'Class'
          }
        });
      }
    } catch (cassandraError) {
      console.error('❌ Error fetching teacher details from Cassandra:', cassandraError);
    }
    
    // If no teacher found, return basic info
    return res.status(404).json({ 
      success: false, 
      message: "Teacher not found" 
    });
    
  } catch (error) {
    console.error("❌ Error fetching teacher details:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Failed to fetch teacher details" 
    });
  }
});

const HOST = process.env.HOST || '0.0.0.0';
const PORT = process.env.PORT || (process.env.NODE_ENV === 'production' ? 443 : 3000);
const PROTOCOL = process.env.NODE_ENV === 'production' && httpServer instanceof https.Server ? 'https' : 'http';

// Global error handler - return JSON instead of Express's default HTML page
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err.message);
  console.error(err.stack);
  if (res.headersSent) {
    return next(err);
  }
  res.status(err.status || 500).json({
    message: err.message || 'Internal Server Error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

httpServer.listen(PORT, HOST, () => {
  console.log(`🚀 Server running on ${PROTOCOL}://${HOST}:${PORT}`);
  console.log(`📍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 API Base URL: ${PROTOCOL}://${HOST}:${PORT}`);
});

module.exports = app;

