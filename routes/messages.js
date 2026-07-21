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
    const { sender, recipient, senderName, text, encrypted, publicKey, messageHash } = req.body;

    if (!sender || !recipient || !text) {
        return res.status(400).json({ message: "Missing required fields" });
    }

    const chatId = [sender, recipient].sort().join("_");
    const messageId = uuidv1();
    const timestamp = new Date();

    // Persist to AstraDB first to ensure message is saved
    try {
        await client.execute(
            `INSERT INTO messages
             (id, sender_email, recipient_email, text, timestamp, is_read, chat_id, created_at, sender_name, encrypted, public_key, message_hash)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                messageId, sender, recipient, text, timestamp,
                false, chatId, timestamp,
                senderName || sender.split('@')[0],
                encrypted === true,
                publicKey || null,
                messageHash || null
            ],
            { prepare: true }
        );
    } catch (dbError) {
        console.error('❌ Message DB write failed:', dbError.message);
        return res.status(500).json({ message: "Failed to save message" });
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
        messageHash: messageHash || null
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
        timestamp: timestamp.getTime()
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
        
        query += ` ORDER BY timestamp DESC LIMIT ?`;
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

        console.log(`🔍 Fetching messages between ${currentUserEmail} and ${contactEmail}`);

        // Create chat ID by sorting emails alphabetically
        const chatId = [currentUserEmail, contactEmail].sort().join("_");

        // Fetch messages from AstraDB using existing messages table
        const query = `
            SELECT id, sender_email, recipient_email, text, timestamp, is_read, chat_id, sender_name, encrypted, public_key, message_hash
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
            messageHash: row.message_hash || null
        }));

        console.log(`✅ Found ${messages.length} messages`);

        return res.status(200).json({
            success: true,
            messages: messages,
            chatId: chatId
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

        console.log(`🔍 [Query] Fetching messages between ${currentUserEmail} and ${contactEmail}`);

        // Create chat ID by sorting emails alphabetically
        const chatId = [currentUserEmail, contactEmail].sort().join("_");

        // Fetch messages from AstraDB using existing messages table
        // Fetch only the most recent 100 messages to handle large chat histories efficiently
        const query = `
            SELECT id, sender_email, recipient_email, text, timestamp, is_read, chat_id, sender_name, encrypted, public_key, message_hash
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
            messageHash: row.message_hash || null
        })).reverse(); // Reverse to show oldest first (chronological order)

        console.log(`✅ [Query] Found ${messages.length} messages`);

        return res.status(200).json({
            success: true,
            messages: messages,
            chatId: chatId
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
                WHERE teacher_email = ? AND (status = ? OR status = ?)
                ALLOW FILTERING
            `;
            const result = await client.execute(query, [teacherEmail, 'accepted', 'subscribed'], { prepare: true });

            if (result.rows && result.rows.length > 0) {
                for (const row of result.rows) {
                    const studentName = row.student_name || row.student_email?.split('@')[0] || 'Student';
                    const studentProfilePic = row.student_profile_pic || null;

                    subscribedStudents.push({
                        id: row.id,
                        email: row.student_email,
                        name: studentName,
                        profilePic: studentProfilePic,
                        subject: row.subject,
                        className: row.class_name,
                        charge: 0,
                        status: row.status,
                        enrollmentDate: row.created_at,
                        lastMessage: '',
                        lastMessageTime: '',
                        unreadCount: 0
                    });
                }
            }
        } catch (dbError) {
            console.error('Error fetching contacts from Cassandra:', dbError);
        }

        // Fallback to in-memory accepted bookings
        if (subscribedStudents.length === 0) {
            try {
                // Get booking requests from in-memory storage
                const bookingRequests = global.bookingRequests || new Map();
                const bookings = Array.from(bookingRequests.values())
                    .filter(booking => 
                        booking.teacherEmail === teacherEmail && 
                        booking.status === 'accepted'
                    );

                for (const booking of bookings) {
                    subscribedStudents.push({
                        id: booking.id,
                        email: booking.studentEmail,
                        name: booking.studentName || booking.studentEmail?.split('@')[0] || 'Student',
                        profilePic: booking.studentInfo?.profilePic || null,
                        subject: booking.subject,
                        className: booking.className,
                        charge: booking.charge,
                        status: booking.status,
                        enrollmentDate: booking.timestamp,
                        lastMessage: '',
                        lastMessageTime: '',
                        unreadCount: 0
                    });
                }
            } catch (fallbackError) {
                console.error('Error in fallback storage:', fallbackError);
            }
        }

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
                WHERE student_email = ? AND status = ?
                ALLOW FILTERING
            `;
            const result = await client.execute(query, [studentEmail, 'accepted'], { prepare: true });

            if (result.rows && result.rows.length > 0) {
                for (const row of result.rows) {
                    const teacherName = row.teacher_name || row.teacher_email?.split('@')[0] || 'Teacher';
                    const teacherProfilePic = row.teacher_profile_pic || null;

                    subscribedTeachers.push({
                        id: row.id,
                        email: row.teacher_email,
                        name: teacherName,
                        profilePic: teacherProfilePic,
                        subject: row.subject,
                        className: row.class_name,
                        charge: 0,
                        status: row.status,
                        enrollmentDate: row.created_at,
                        lastMessage: '',
                        lastMessageTime: '',
                        unreadCount: 0
                    });
                }
            }
        } catch (dbError) {
            console.error('Error fetching contacts from Cassandra:', dbError);
        }

        // Fallback to in-memory accepted bookings
        if (subscribedTeachers.length === 0) {
            try {
                const bookingRequests = global.bookingRequests || new Map();
                const bookings = Array.from(bookingRequests.values())
                    .filter(booking =>
                        booking.studentEmail === studentEmail &&
                        booking.status === 'accepted'
                    );

                for (const booking of bookings) {
                    subscribedTeachers.push({
                        id: booking.id,
                        email: booking.teacherEmail,
                        name: booking.teacherEmail?.split('@')[0] || 'Teacher',
                        profilePic: null,
                        subject: booking.subject,
                        className: booking.className,
                        charge: booking.charge,
                        status: booking.status,
                        enrollmentDate: booking.timestamp,
                        lastMessage: '',
                        lastMessageTime: '',
                        unreadCount: 0
                    });
                }
            } catch (fallbackError) {
                console.error('Error in fallback storage:', fallbackError);
            }
        }

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

// Get chat messages between current user and contact (URL param format)
router.get("/:contactEmail", verifyToken, async (req, res) => {
    try {
        const { contactEmail } = req.params;
        const currentUserEmail = req.user?.email || req.query.userEmail;

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

        console.log(`🔍 Fetching messages between ${currentUserEmail} and ${contactEmail}`);

        // Create chat ID by sorting emails alphabetically
        const chatId = [currentUserEmail, contactEmail].sort().join("_");

        // Fetch messages from AstraDB using existing messages table
        const query = `
            SELECT id, sender_email, recipient_email, text, timestamp, is_read, chat_id, sender_name, encrypted, public_key, message_hash
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
            messageHash: row.message_hash || null
        }));

        console.log(`✅ Found ${messages.length} messages`);

        return res.status(200).json({
            success: true,
            messages: messages,
            chatId: chatId
        });

    } catch (error) {
        console.error("❌ Error fetching messages:", error);
        return res.status(500).json({
            success: false,
            error: "Failed to fetch messages"
        });
    }
});


module.exports = router;
