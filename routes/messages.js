const express = require("express");
const router = express.Router();

const verifyToken = require("./../utils/verifyToken")
const { v1: uuidv1 } = require('uuid');
const axios = require("axios");
const client = require("../config/db");

const sendExpoPushNotification = async (to, title, body) => {
    try {
        const message = {
            to,
            sound: "default",
            title,
            body,
        };

        await axios.post("https://exp.host/--/api/v2/push/send", message, {
            headers: {
                "Content-Type": "application/json",
            },
        });
    } catch (err) {
        console.error("Failed to send push notification:", err?.response?.data || err.message);
    }
};

router.post("/send", verifyToken, async (req, res) => {
    const { sender, recipient, senderName, text, encrypted, publicKey, messageHash, subject, class_name, boardOrUniversity, contactTitle } = req.body;

    if (!sender || !recipient || !text) {
        return res.status(400).json({ message: "Missing required fields" });
    }

    // Generate context-aware chat ID
    // Prefer the full contactTitle (e.g. "Physics - Aligarh Muslim University (2nd Year)") as it uniquely
    // captures details (like university year) that subject/class_name/boardOrUniversity alone don't.
    // Fall back to the individual context fields for backward compatibility.
    const contextParts = [sender, recipient];
    if (contactTitle) {
        contextParts.push(contactTitle.toLowerCase().trim().replace(/\s+/g, '_'));
    } else {
        if (subject) contextParts.push(subject.toLowerCase().replace(/\s+/g, '_'));
        if (class_name) contextParts.push(class_name.toLowerCase().replace(/\s+/g, '_'));
        if (boardOrUniversity) contextParts.push(boardOrUniversity.toLowerCase().replace(/\s+/g, '_'));
    }
    
    const chatId = contextParts.sort().join("_");
    const messageId = uuidv1();
    const timestamp = new Date();

    // Persist to AstraDB first to ensure message is saved
    try {
        await client.execute(
            `INSERT INTO messages
             (id, sender_email, recipient_email, text, timestamp, is_read, chat_id, created_at, sender_name, encrypted, public_key, message_hash, subject, class_name, board_or_university, title)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                messageId, sender, recipient, text, timestamp,
                false, chatId, timestamp,
                senderName || sender.split('@')[0],
                encrypted === true,
                publicKey || null,
                messageHash || null,
                subject || null,
                class_name || null,
                boardOrUniversity || null,
                contactTitle || null
            ],
            { prepare: true }
        );
    } catch (dbError) {
        console.error('❌ Message DB write failed:', dbError.message);
        return res.status(500).json({ message: "Failed to save message" });
    }

    // Save contact record if sender is student and recipient is teacher (or vice versa)
    // This ensures contacts only appear when messaging actually happens
    try {
        // Check if contact already exists for this specific title (or subject/class/board combination)
        // This allows multiple contacts between same teacher-student pair for different subjects/tuitions
        const contactCheckQuery = contactTitle
            ? `
                SELECT * FROM contacts
                WHERE teacher_email = ? AND student_email = ? AND title = ?
                LIMIT 1
                ALLOW FILTERING
            `
            : `
                SELECT * FROM contacts
                WHERE teacher_email = ? AND student_email = ? AND subject = ? AND class_name = ? AND board_or_university = ?
                LIMIT 1
                ALLOW FILTERING
            `;
        
        // Determine teacher and student emails
        let teacherEmail, studentEmail;
        try {
            const senderQuery = `
                SELECT role FROM users WHERE email = ? LIMIT 1
            `;
            const senderResult = await client.execute(senderQuery, [sender], { prepare: true });
            const senderIsStudent = senderResult.rows && senderResult.rows.length > 0 && senderResult.rows[0].role === 'student';

            if (senderIsStudent) {
                teacherEmail = recipient;
                studentEmail = sender;
            } else {
                teacherEmail = sender;
                studentEmail = recipient;
            }
        } catch (roleCheckError) {
            console.warn('⚠️ Could not determine user roles for contact check:', roleCheckError.message);
            // Default to assuming sender is student
            teacherEmail = recipient;
            studentEmail = sender;
        }

        const existingContact = await client.execute(
            contactCheckQuery,
            contactTitle
                ? [teacherEmail, studentEmail, contactTitle]
                : [teacherEmail, studentEmail, subject || '', class_name || '', boardOrUniversity || ''],
            { prepare: true }
        );

        if (!existingContact.rows || existingContact.rows.length === 0) {
            // Get user profiles for contact creation
            let teacherName, studentName, teacherProfilePic, studentProfilePic;

            try {
                // Get teacher profile
                const teacherQuery = `
                    SELECT name, profileimage FROM users WHERE email = ? LIMIT 1
                `;
                const teacherResult = await client.execute(teacherQuery, [teacherEmail], { prepare: true });
                if (teacherResult.rows && teacherResult.rows.length > 0) {
                    teacherName = teacherResult.rows[0].name || teacherEmail.split('@')[0];
                    teacherProfilePic = teacherResult.rows[0].profileimage || null;
                } else {
                    teacherName = teacherEmail.split('@')[0];
                    teacherProfilePic = null;
                }

                // Get student profile
                const studentQuery = `
                    SELECT name, profileimage FROM users WHERE email = ? LIMIT 1
                `;
                const studentResult = await client.execute(studentQuery, [studentEmail], { prepare: true });
                if (studentResult.rows && studentResult.rows.length > 0) {
                    studentName = studentResult.rows[0].name || studentEmail.split('@')[0];
                    studentProfilePic = studentResult.rows[0].profileimage || null;
                } else {
                    studentName = studentEmail.split('@')[0];
                    studentProfilePic = null;
                }

                // Check booking status to determine correct contact status
                let contactStatus = 'accepted';
                try {
                    const bookingQuery = `
                        SELECT status FROM booking_requests
                        WHERE teacher_email = ? AND student_email = ? AND subject = ?
                        ALLOW FILTERING
                    `;
                    const bookingResult = await client.execute(bookingQuery, [teacherEmail, studentEmail, subject || ''], { prepare: true });
                    
                    if (bookingResult.rows && bookingResult.rows.length > 0) {
                        // Use the most recent booking status
                        const booking = bookingResult.rows[0];
                        if (booking.status === 'subscribed') {
                            contactStatus = 'subscribed';
                        }
                    }
                } catch (bookingError) {
                    console.warn('⚠️ Could not check booking status:', bookingError.message);
                    // Default to 'accepted' if check fails
                }

                // Create unique contact ID based on teacher, student, and title (or subject/class/board)
                // This ensures separate contacts for different tuitions (e.g. same subject+university but different year)
                const titlePart = contactTitle
                    ? contactTitle.replace(/[^a-zA-Z0-9]/g, '_')
                    : null;
                const subjectPart = (subject || 'General').replace(/[^a-zA-Z0-9]/g, '_');
                const classPart = (class_name || 'General').replace(/[^a-zA-Z0-9]/g, '_');
                const boardPart = (boardOrUniversity || '').replace(/[^a-zA-Z0-9]/g, '_');
                
                const contactId = titlePart
                    ? `contact_${teacherEmail}_${studentEmail}_${titlePart}`
                    : `contact_${teacherEmail}_${studentEmail}_${subjectPart}_${classPart}_${boardPart}`;

                    const insertContactQuery = `
                        INSERT INTO contacts (
                            id, teacher_email, student_email, teacher_name, student_name,
                            teacher_profile_pic, student_profile_pic, subject, class_name, board_or_university, title, status, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `;

                    await client.execute(insertContactQuery, [
                        contactId,
                        teacherEmail,
                        studentEmail,
                        teacherName,
                        studentName,
                        teacherProfilePic,
                        studentProfilePic,
                        subject || '',
                        class_name || '',
                        boardOrUniversity || '',
                        contactTitle || '',
                        contactStatus,
                        new Date(),
                        new Date()
                    ], { prepare: true });

                    console.log('✅ Contact saved:', contactId, 'title:', contactTitle || subject || 'General');
            } catch (roleCheckError) {
                console.warn('⚠️ Could not save contact:', roleCheckError.message);
            }
        }
    } catch (contactError) {
        console.warn('⚠️ Contact save failed (non-critical):', contactError.message);
        // Don't fail message send if contact save fails
    }

    const messagePayload = {
        messageId,
        chatId,
        senderEmail: sender,
        recipientEmail: recipient,
        text,
        senderName: senderName || sender.split('@')[0],
        timestamp: timestamp.getTime(),
        isRead: false,
        encrypted: encrypted === true,
        publicKey: publicKey || null,
        messageHash: messageHash || null,
        subject: subject || null,
        className: class_name || null,
        boardOrUniversity: boardOrUniversity || null
    };

    // Emit via WebSocket for real-time delivery
    try {
        const { getIO } = require('../socket');
        const io = getIO();
        io.to(`user:${recipient}`).emit('new_message', messagePayload);
        // Echo back to sender's other devices/tabs
        io.to(`user:${sender}`).emit('message_sent', messagePayload);
    } catch (socketError) {
        console.warn('⚠️ WebSocket emit failed:', socketError.message);
    }

    res.status(200).json({
        message: "Message sent successfully",
        messageId,
        chatId,
        encrypted: encrypted === true,
        timestamp: timestamp.getTime(),
        subject: subject || null,
        className: class_name || null,
        boardOrUniversity: boardOrUniversity || null
    });
});




router.post("/broadcast", verifyToken, async (req, res) => {
    const {
        subject,
        className,
        message,
        broadcastType = 'subject'
    } = req.body;

    const userEmail = req.user.email;
    const userName = req.user.name;

    if (!subject || !message) {
        return res.status(400).json({ 
            error: "Missing required fields: subject and message are required" 
        });
    }

    try {
        // Get subscribed students for this teacher-subject-class combination
        const { getSubjectGroupMembers, broadcastToSubjectGroup } = require('../socket');
        
        const subscribedStudents = getSubjectGroupMembers(userEmail, subject, className);
        
        if (subscribedStudents.length === 0) {
            return res.status(404).json({ 
                error: "No subscribed students found for this subject and class",
                subject: subject,
                className: className
            });
        }

        // Create broadcast message
        const broadcastId = `broadcast_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const timestamp = new Date();
        
        // Store broadcast message in database
        const query = `
            INSERT INTO broadcast_messages_table 
            (teacherEmail, className, subject, id, studentEmails, studentNames, isBroadcast, sender, teacherName, text, time, timestamp) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?)
        `;

        const params = [
            userEmail,
            className || '',
            subject,
            broadcastId,
            JSON.stringify(subscribedStudents),
            JSON.stringify(subscribedStudents), // Will be populated with actual names later
            true,
            userEmail,
            userName,
            message,
            timestamp.toLocaleTimeString(),
            timestamp
        ];

        await client.execute(query, params, { prepare: true });

        // Real-time broadcast to subscribed students
        const broadcastData = {
            id: broadcastId,
            teacherEmail: userEmail,
            teacherName: userName,
            subject: subject,
            className: className || 'General',
            message: message,
            type: broadcastType,
            timestamp: timestamp.toISOString(),
            studentCount: subscribedStudents.length
        };

        // Broadcast to all subscribed students
        const actualStudentCount = broadcastToSubjectGroup(
            userEmail, 
            subject, 
            className || '', 
            'new_broadcast', 
            broadcastData
        );

        console.log(`📢 Teacher ${userEmail} broadcast to ${subject}:${className} - ${actualStudentCount} students`);

        return res.status(200).json({
            success: true,
            broadcastId: broadcastId,
            message: "Broadcast sent successfully",
            studentCount: actualStudentCount,
            subject: subject,
            className: className,
            timestamp: timestamp.toISOString()
        });

    } catch (error) {
        console.error("Broadcast backend error:", error);
        return res.status(500).json({ error: "Failed to send broadcast" });
    }
});

router.get("/my-subject-groups", verifyToken, async (req, res) => {
    try {
        const userEmail = req.user.email;
        const { getTeacherSubjectGroups } = require('../socket');
        
        const subjectGroups = getTeacherSubjectGroups(userEmail);
        
        return res.status(200).json({
            success: true,
            subjectGroups: subjectGroups,
            totalGroups: subjectGroups.length
        });
    } catch (error) {
        console.error("Error fetching subject groups:", error);
        return res.status(500).json({ error: "Failed to fetch subject groups" });
    }
});

router.get("/broadcast-history", verifyToken, async (req, res) => {
    try {
        const userEmail = req.user.email;
        const { limit = 20, subject, className } = req.query;
        
        let query = `
            SELECT * FROM broadcast_messages_table 
            WHERE teacherEmail = ? 
        `;
        
        const params = [userEmail];
        
        if (subject) {
            query += ` AND subject = ?`;
            params.push(subject);
        }
        
        if (className) {
            query += ` AND className = ?`;
            params.push(className);
        }
        
        query += ` ORDER BY id DESC LIMIT ?`;
        params.push(parseInt(limit));
        
        const results = await client.execute(query, params, { prepare: true });
        
        const broadcasts = results.rows.map(row => ({
            id: row.id.toString(),
            subject: row.subject,
            className: row.className,
            message: row.text,
            studentEmails: JSON.parse(row.studentemails || '[]'),
            studentNames: JSON.parse(row.studentnames || '[]'),
            studentCount: JSON.parse(row.studentemails || '[]').length,
            timestamp: row.timestamp,
            time: row.time
        }));
        
        return res.status(200).json({
            success: true,
            broadcasts: broadcasts,
            total: broadcasts.length
        });
    } catch (error) {
        console.error("Error fetching broadcast history:", error);
        return res.status(500).json({ error: "Failed to fetch broadcast history" });
    }
});



router.post("/get_teacher_broadcast",verifyToken, async (req, res) => {
    const { userEmail, type } = req.body;
    if (type !== 'teacher') {
        return res.status(400).json({ error: "Invalid type" });
    }
    const query = `
        SELECT * FROM broadcast_table WHERE teacheremail = ? ALLOW FILTERING;
      `;
    const results = await client.execute(query, [userEmail], { prepare: true });
    const resultBody = []
    for (const result of results.rows) {
        resultBody.push(JSON.parse(JSON.stringify(result)))
    }

    res.status(200).json({ teacherBroadcastData: resultBody });
})


router.post("/broadcast-message-list",verifyToken, async (req, res) => {
    const { userEmail, userType } = req.body;
    if (userType === 'student') {
        return res.status(400).json({ error: "Invalid type" });
    }
    const query = `
        SELECT * FROM broadcast_messages_table WHERE teacheremail = ? LIMIT 20 ALLOW FILTERING;
      `;
    const results = await client.execute(query, [userEmail], { prepare: true });
    const resultBody = []
    for (const result of results.rows) {
        resultBody.push(JSON.parse(JSON.stringify(result)))
    }
    res.status(200).json({ teacherBroadcastData: resultBody });
})

router.post("/broadcast-message-list-add",verifyToken, async (req, res) => {
    console.log(req.body)

    const {userType,
        teacherEmail,
        className,
        subject,
        studentEmails,
        studentNames,
        isBroadcast,
        sender,
        teacherName,
        text} = req.body;
    if (userType === 'student') {
        return res.status(400).json({ error: "Invalid type" });
    }
    const id = uuidv1(); // timeuuid
    const timestamp = new Date();
    const time = timestamp.toLocaleTimeString();
    const messageContent = `📢 Broadcast: ${text}\nDate: ${new Date().toLocaleDateString()}\nTime: ${time}\n`;
    const query = `
    INSERT INTO broadcast_messages_table 
    (teacherEmail, className, subject, id, studentEmails, studentNames, isBroadcast, sender, teacherName, text, time, timestamp) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?)
  `;


    const params = [
        teacherEmail,
        className,
        subject,
        id,
        JSON.stringify(studentEmails),
        JSON.stringify(studentNames),
        isBroadcast,
        sender,
        teacherName,
        messageContent,
        time,
        timestamp
    ];

    try {
        console.log("📤 Starting broadcast insert with params:", params);
        await client.execute(query, params, { prepare: true });
        console.log("✅ Broadcast message inserted successfully to Cassandra");
        console.log("📝 Firebase operations removed - only Cassandra insert performed");
        return res.status(200).json({ type: "success" });
    } catch (err) {
        console.error("❌ Error inserting broadcast message:", err);
        console.error("❌ Error stack:", err.stack);
        return res.status(500).json({ type: "error", message: "Server error", details: err.message });
    }
})






// Get chat messages between current user and contact (URL param format)
router.get("/:contactEmail", verifyToken, async (req, res) => {
    try {
        const { contactEmail } = req.params;
        const currentUserEmail = req.user?.email || req.query.userEmail;
        const { subject, class_name, boardOrUniversity, contactTitle } = req.query;

        if (!currentUserEmail) {
            return res.status(400).json({
                success: false,
                error: "Current user email required"
            });
        }

        if (!contactEmail) {
            return res.status(400).json({
                success: false,
                error: "Contact email required"
            });
        }

        console.log(`🔍 Fetching messages between ${currentUserEmail} and ${contactEmail} with context:`, { subject, class_name, boardOrUniversity, contactTitle });

        // Generate context-aware chat ID
        // Prefer contactTitle (matches /send route's logic) as it uniquely captures details
        // that subject/class_name/boardOrUniversity alone don't (e.g. university year).
        const contextParts = [currentUserEmail, contactEmail];
        if (contactTitle) {
            contextParts.push(contactTitle.toLowerCase().trim().replace(/\s+/g, '_'));
        } else {
            if (subject) contextParts.push(subject.toLowerCase().replace(/\s+/g, '_'));
            if (class_name) contextParts.push(class_name.toLowerCase().replace(/\s+/g, '_'));
            if (boardOrUniversity) contextParts.push(boardOrUniversity.toLowerCase().replace(/\s+/g, '_'));
        }
        
        const chatId = contextParts.sort().join("_");

        // Fetch messages from AstraDB using existing messages table
        const query = `
            SELECT id, sender_email, recipient_email, text, timestamp, is_read, chat_id, sender_name, encrypted, public_key, message_hash, subject, class_name, board_or_university, title
            FROM messages
            WHERE chat_id = ?
            ORDER BY id ASC
        `;

        const result = await client.execute(query, [chatId], { prepare: true });
        const messages = result.rows.map(row => ({
            id: row.id.toString(),
            sender: row.sender_email === currentUserEmail ? 'me' : 'other',
            text: row.text,
            senderEmail: row.sender_email,
            recipientEmail: row.recipient_email,
            senderName: row.sender_name,
            time: row.timestamp ? new Date(row.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
            timestamp: row.timestamp,
            read: row.is_read || false,
            encrypted: row.encrypted || false,
            publicKey: row.public_key || null,
            messageHash: row.message_hash || null,
            subject: row.subject || null,
            className: row.class_name || null,
            boardOrUniversity: row.board_or_university || null,
            contactTitle: row.title || null
        }));

        console.log(`✅ Found ${messages.length} messages`);

        return res.status(200).json({
            success: true,
            messages: messages,
            chatId: chatId,
            subject: subject || null,
            className: class_name || null,
            boardOrUniversity: boardOrUniversity || null
        });

    } catch (error) {
        console.error("❌ Error fetching messages:", error);
        return res.status(500).json({
            success: false,
            error: "Failed to fetch messages"
        });
    }
});

// Get chat messages - supports both /:contactEmail and ?chatId= query param
router.get("/", verifyToken, async (req, res) => {
    try {
        // Support query param format: ?chatId=email1_email2
        const chatIdFromQuery = req.query.chatId;
        const currentUserEmail = req.user?.email || req.query.userEmail;
        const { subject, class_name, boardOrUniversity } = req.query;

        if (!currentUserEmail) {
            return res.status(400).json({
                success: false,
                error: "Current user email required"
            });
        }

        if (!chatIdFromQuery) {
            return res.status(400).json({
                success: false,
                error: "chatId query parameter required"
            });
        }

        // Parse chatId to get the other person's email
        const emails = chatIdFromQuery.split('_');
        const contactEmail = emails.find(e => e !== currentUserEmail) || emails[1];

        console.log(`🔍 [Query] Fetching messages between ${currentUserEmail} and ${contactEmail} with context:`, { subject, class_name, boardOrUniversity });

        // Generate context-aware chat ID
        const contextParts = [currentUserEmail, contactEmail];
        if (subject) contextParts.push(subject.toLowerCase().replace(/\s+/g, '_'));
        if (class_name) contextParts.push(class_name.toLowerCase().replace(/\s+/g, '_'));
        if (boardOrUniversity) contextParts.push(boardOrUniversity.toLowerCase().replace(/\s+/g, '_'));
        
        const chatId = contextParts.sort().join("_");

        // Fetch messages from AstraDB using existing messages table
        // Fetch only the most recent 100 messages to handle large chat histories efficiently
        const query = `
            SELECT id, sender_email, recipient_email, text, timestamp, is_read, chat_id, sender_name, encrypted, public_key, message_hash, subject, class_name, board_or_university
            FROM messages
            WHERE chat_id = ?
            ORDER BY id DESC
            LIMIT 100
        `;

        const result = await client.execute(query, [chatId], { prepare: true });
        const messages = result.rows.map(row => ({
            id: row.id.toString(),
            sender: row.sender_email === currentUserEmail ? 'me' : 'other',
            text: row.text,
            senderEmail: row.sender_email,
            recipientEmail: row.recipient_email,
            senderName: row.sender_name,
            time: row.timestamp ? new Date(row.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
            timestamp: row.timestamp,
            read: row.is_read || false,
            encrypted: row.encrypted || false,
            publicKey: row.public_key || null,
            messageHash: row.message_hash || null,
            subject: row.subject || null,
            className: row.class_name || null,
            boardOrUniversity: row.board_or_university || null
        })).reverse(); // Reverse to show oldest first (chronological order)

        console.log(`✅ [Query] Found ${messages.length} messages`);

        return res.status(200).json({
            success: true,
            messages: messages,
            chatId: chatId,
            subject: subject || null,
            className: class_name || null,
            boardOrUniversity: boardOrUniversity || null
        });

    } catch (error) {
        console.error("❌ Error fetching messages (query):", error);
        return res.status(500).json({
            success: false,
            error: "Failed to fetch messages"
        });
    }
});

// GET /api/chat/contacts - Get teacher's subscribed students for chat
router.get('/contacts', verifyToken, async (req, res) => {
    try {
        const teacherEmail = req.user.email;
        
        console.log(`📚 Fetching subscribed students for teacher: ${teacherEmail}`);

        // Try to fetch from contacts table first
        let subscribedStudents = [];
        try {
            const query = `
                SELECT * FROM contacts
                WHERE teacher_email = ?
                ALLOW FILTERING
            `;
            const result = await client.execute(query, [teacherEmail], { prepare: true });

            if (result.rows && result.rows.length > 0) {
                for (const row of result.rows) {
                    const studentName = row.student_name || row.student_email?.split('@')[0] || 'Student';
                    const studentProfilePic = row.student_profile_pic || null;
                    
                    // Create a unique display name that includes subject, class, and board/university information
                    // This allows the same student to appear multiple times for different subjects
                    let contextInfo = [];
                    if (row.subject) contextInfo.push(row.subject);
                    if (row.class_name) contextInfo.push(row.class_name);
                    if (row.board_or_university) contextInfo.push(row.board_or_university);
                    
                    // Prefer the stored full title (matches exactly what was shown in TeacherDetails)
                    const contextLabel = row.title || (contextInfo.length > 0 ? contextInfo.join(' - ') : null);
                    const displayName = contextLabel 
                        ? `${studentName} (${contextLabel})`
                        : studentName;

                    subscribedStudents.push({
                        id: row.id,
                        email: row.student_email,
                        name: displayName, // Enhanced name with subject info
                        originalName: studentName, // Keep original name for reference
                        profilePic: studentProfilePic,
                        subject: row.subject,
                        className: row.class_name,
                        boardOrUniversity: row.board_or_university || null,
                        contactTitle: row.title || null,
                        charge: 0,
                        status: row.status,
                        enrollmentDate: row.created_at,
                        lastMessage: '',
                        lastMessageTime: '',
                        unreadCount: 0,
                        isSubjectSpecific: !!row.subject // Flag to indicate this is a subject-specific contact
                    });
                }
            }
        } catch (dbError) {
            console.error('Error fetching contacts from Cassandra:', dbError);
        }

        // No fallback to booking requests: contacts only exist after a message is sent.
        console.log(`✅ Found ${subscribedStudents.length} subscribed students`);

        res.json({
            success: true,
            contacts: subscribedStudents
        });

    } catch (error) {
        console.error('Error fetching subscribed students:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch subscribed students'
        });
    }
});

// GET /api/chat/teacher-contacts - Get all teachers for a student
router.get('/teacher-contacts', verifyToken, async (req, res) => {
    try {
        const studentEmail = req.user.email;
        
        console.log(`📚 Fetching teachers for student: ${studentEmail}`);

        // Try to fetch from contacts table first
        let subscribedTeachers = [];
        try {
            const query = `
                SELECT * FROM contacts
                WHERE student_email = ?
                ALLOW FILTERING
            `;
            const result = await client.execute(query, [studentEmail], { prepare: true });

            if (result.rows && result.rows.length > 0) {
                for (const row of result.rows) {
                    const teacherName = row.teacher_name || row.teacher_email?.split('@')[0] || 'Teacher';
                    const teacherProfilePic = row.teacher_profile_pic || null;
                    
                    // Create a unique display name that includes subject, class, and board/university information
                    // This allows the same teacher to appear multiple times for different subjects
                    let contextInfo = [];
                    if (row.subject) contextInfo.push(row.subject);
                    if (row.class_name) contextInfo.push(row.class_name);
                    if (row.board_or_university) contextInfo.push(row.board_or_university);
                    
                    // Prefer the stored full title (matches exactly what was shown in TeacherDetails)
                    const contextLabel = row.title || (contextInfo.length > 0 ? contextInfo.join(' - ') : null);
                    const displayName = contextLabel 
                        ? `${teacherName} (${contextLabel})`
                        : teacherName;

                    subscribedTeachers.push({
                        id: row.id,
                        email: row.teacher_email,
                        name: displayName, // Enhanced name with subject info
                        originalName: teacherName, // Keep original name for reference
                        profilePic: teacherProfilePic,
                        subject: row.subject,
                        className: row.class_name,
                        boardOrUniversity: row.board_or_university || null,
                        contactTitle: row.title || null,
                        charge: 0,
                        status: row.status,
                        enrollmentDate: row.created_at,
                        lastMessage: '',
                        lastMessageTime: '',
                        unreadCount: 0,
                        isSubjectSpecific: !!row.subject // Flag to indicate this is a subject-specific contact
                    });
                }
            }
        } catch (dbError) {
            console.error('Error fetching contacts from Cassandra:', dbError);
        }

        // No fallback to booking requests: contacts only exist after a message is sent.
        console.log(`✅ Found ${subscribedTeachers.length} subscribed teachers`);

        res.json({
    success: true,
            contacts: subscribedTeachers
        });

    } catch (error) {
        console.error('Error fetching subscribed teachers:', error);
        res.status(500).json({
    success: false,
            message: 'Failed to fetch subscribed teachers'
        });
    }
});


module.exports = router;
