const express = require("express");
const router = express.Router();
const verifyToken = require("./../utils/verifyToken");
const client = require("../config/db");

// GET /api/chat/history/:contactEmail - Get chat history between current user and contact
router.get('/history/:contactEmail', verifyToken, async (req, res) => {
    try {
        const { contactEmail } = req.params;
        const currentUserEmail = req.user?.email;
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
        
        console.log(`🔍 [History] Fetching messages between ${currentUserEmail} and ${contactEmail} with context:`, { subject, class_name, boardOrUniversity, contactTitle });
        
        // Create context-aware chat ID to support subject-specific conversations
        // Prefer contactTitle (matches /send and /:contactEmail endpoints)
        const contextParts = [currentUserEmail, contactEmail];
        if (contactTitle) {
            contextParts.push(contactTitle.toLowerCase().trim().replace(/\s+/g, '_'));
        } else {
            if (subject) contextParts.push(subject.toLowerCase().replace(/\s+/g, '_'));
            if (class_name) contextParts.push(class_name.toLowerCase().replace(/\s+/g, '_'));
            if (boardOrUniversity) contextParts.push(boardOrUniversity.toLowerCase().replace(/\s+/g, '_'));
        }
        
        const chatId = contextParts.sort().join("_");
        
        // Query messages table for messages between these users with specific context
        try {
            const query = `
                SELECT * FROM messages 
                WHERE chat_id = ? 
                ORDER BY id DESC
                LIMIT 50
            `;
            const result = await client.execute(query, [chatId], { prepare: true });
            
            let messages = [];
            
            if (result.rows && result.rows.length > 0) {
                messages = result.rows.map(row => ({
                    id: row.id?.toString() || `msg_${Date.now()}`,
                    text: row.text,
                    sender: row.sender_email,
                    recipient: row.recipient_email,
                    timestamp: row.timestamp?.getTime() || Date.now(),
                    isRead: row.is_read || false,
                    isMe: row.sender_email === currentUserEmail,
                    subject: row.subject || null,
                    className: row.class_name || null,
                    boardOrUniversity: row.board_or_university || null
                }));
            }
            
            // Sort by timestamp (newest first)
            messages.sort((a, b) => b.timestamp - a.timestamp);
            
            console.log(`✅ [History] Found ${messages.length} messages for ${chatId}`);
            
            return res.status(200).json({
                success: true,
                messages: messages,
                chatId: chatId,
                subject: subject || null,
                className: class_name || null,
                boardOrUniversity: boardOrUniversity || null
            });
            
        } catch (dbError) {
            console.error('❌ Database error fetching chat history:', dbError);
            return res.status(200).json({
                success: true,
                messages: [],
                chatId: chatId,
                subject: subject || null,
                className: class_name || null,
                boardOrUniversity: boardOrUniversity || null
            });
        }
        
    } catch (error) {
        console.error("❌ Error fetching chat history:", error);
        return res.status(500).json({ 
            success: false,
            error: "Failed to fetch chat history" 
        });
    }
});

// POST /api/chat/sync-all-contacts - Sync all subscribed students as contacts
router.post('/sync-all-contacts', verifyToken, async (req, res) => {
    try {
        const teacherEmail = req.user?.email;
        
        if (!teacherEmail) {
            return res.status(400).json({ 
                success: false,
                error: "Teacher email required" 
            });
        }
        
        console.log(`🔄 Syncing all contacts for teacher: ${teacherEmail}`);
        
        // Get all subscribed bookings
        const query = `
            SELECT * FROM booking_requests 
            WHERE teacher_email = ? AND status = ?
            ALLOW FILTERING
        `;
        const result = await client.execute(query, [teacherEmail, 'subscribed'], { prepare: true });
        
        if (!result.rows || result.rows.length === 0) {
            return res.json({
                success: true,
                created: 0,
                message: "No subscribed students found"
            });
        }
        
        let created = 0;
        
        // For each subscribed student, ensure they're in contacts
        for (const row of result.rows) {
            try {
                // Check if student exists in users table
                const studentQuery = `
                    SELECT name, profilepic FROM users 
                    WHERE email = ? LIMIT 1
                `;
                const studentResult = await client.execute(studentQuery, [row.student_email], { prepare: true });
                
                if (studentResult.rows && studentResult.rows.length > 0) {
                    created++;
                }
            } catch (error) {
                console.error(`Error processing student ${row.student_email}:`, error);
            }
        }
        
        console.log(`✅ Synced ${created} contacts for teacher ${teacherEmail}`);
        
        return res.json({
            success: true,
            created: created,
            message: `Synced ${created} contacts successfully`
        });
        
    } catch (error) {
        console.error("❌ Error syncing contacts:", error);
        return res.status(500).json({ 
            success: false,
            error: "Failed to sync contacts" 
        });
    }
});

// GET /api/chat/contacts - Get all student contacts for a teacher
router.get('/contacts', verifyToken, async (req, res) => {
    try {
        const teacherEmail = req.user?.email;
        
        if (!teacherEmail) {
            return res.status(400).json({ 
                success: false,
                error: "Teacher email required" 
            });
        }
        
        console.log(`🔍 Fetching student contacts for teacher: ${teacherEmail}`);
        
        // Fetch contacts from contacts table where teacher_email matches
        const query = `
            SELECT * FROM contacts
            WHERE teacher_email = ?
            ALLOW FILTERING
        `;
        const result = await client.execute(query, [teacherEmail], { prepare: true });
        
        if (!result.rows || result.rows.length === 0) {
            return res.json({
                success: true,
                contacts: []
            });
        }
        
        // Format contacts for frontend and check actual subscription status
        const contacts = await Promise.all(result.rows.map(async (row) => {
            // Check booking status to determine correct contact status
            let actualStatus = row.status;
            try {
                const bookingQuery = `
                    SELECT status FROM booking_requests
                    WHERE teacher_email = ? AND student_email = ? AND subject = ?
                    ALLOW FILTERING
                `;
                const bookingResult = await client.execute(bookingQuery, [teacherEmail, row.student_email, row.subject || ''], { prepare: true });
                
                if (bookingResult.rows && bookingResult.rows.length > 0) {
                    // Use the most recent booking status
                    const booking = bookingResult.rows[0];
                    if (booking.status === 'subscribed') {
                        actualStatus = 'subscribed';
                    }
                }
            } catch (bookingError) {
                console.warn('⚠️ Could not check booking status for contact:', bookingError.message);
                // Use stored status if check fails
            }

            return {
                id: row.id,
                email: row.student_email,
                name: row.student_name,
                profilePic: row.student_profile_pic,
                subject: row.subject,
                className: row.class_name,
                boardOrUniversity: row.board_or_university,
                contactTitle: row.title,
                status: actualStatus,
                lastMessage: '',
                lastMessageTime: '',
                unreadCount: 0
            };
        }));
        
        console.log(`✅ Found ${contacts.length} student contacts for ${teacherEmail}`);
        
        return res.json({
            success: true,
            contacts: contacts
        });
        
    } catch (error) {
        console.error("❌ Error fetching student contacts:", error);
        return res.status(500).json({ 
            success: false,
            error: "Failed to fetch student contacts" 
        });
    }
});

// GET /api/chat/teacher-contacts - Get all teacher contacts for a student
router.get('/teacher-contacts', verifyToken, async (req, res) => {
    try {
        const studentEmail = req.user?.email;
        
        if (!studentEmail) {
            return res.status(400).json({ 
                success: false,
                error: "Student email required" 
            });
        }
        
        console.log(`🔍 Fetching teacher contacts for student: ${studentEmail}`);
        
        // Fetch contacts from contacts table where student_email matches
        const query = `
            SELECT * FROM contacts
            WHERE student_email = ?
            ALLOW FILTERING
        `;
        const result = await client.execute(query, [studentEmail], { prepare: true });
        
        if (!result.rows || result.rows.length === 0) {
            return res.json({
                success: true,
                contacts: []
            });
        }
        
        // Format contacts for frontend and check actual subscription status
        const contacts = await Promise.all(result.rows.map(async (row) => {
            // Check booking status to determine correct contact status
            let actualStatus = row.status;
            try {
                const bookingQuery = `
                    SELECT status FROM booking_requests
                    WHERE teacher_email = ? AND student_email = ? AND subject = ?
                    ALLOW FILTERING
                `;
                const bookingResult = await client.execute(bookingQuery, [row.teacher_email, studentEmail, row.subject || ''], { prepare: true });
                
                if (bookingResult.rows && bookingResult.rows.length > 0) {
                    // Use the most recent booking status
                    const booking = bookingResult.rows[0];
                    if (booking.status === 'subscribed') {
                        actualStatus = 'subscribed';
                    }
                }
            } catch (bookingError) {
                console.warn('⚠️ Could not check booking status for contact:', bookingError.message);
                // Use stored status if check fails
            }

            return {
                id: row.id,
                email: row.teacher_email,
                name: row.teacher_name,
                profilePic: row.teacher_profile_pic,
                subject: row.subject,
                className: row.class_name,
                boardOrUniversity: row.board_or_university,
                contactTitle: row.title,
                status: actualStatus,
                lastMessage: '',
                lastMessageTime: '',
                unreadCount: 0
            };
        }));
        
        console.log(`✅ Found ${contacts.length} teacher contacts for ${studentEmail}`);
        
        return res.json({
            success: true,
            contacts: contacts
        });
        
    } catch (error) {
        console.error("❌ Error fetching teacher contacts:", error);
        return res.status(500).json({ 
            success: false,
            error: "Failed to fetch teacher contacts" 
        });
    }
});

// POST /api/chat/mark-all-read - Mark all messages as read for current user
router.post('/mark-all-read', verifyToken, async (req, res) => {
    try {
        const { userType } = req.body;
        const currentUserEmail = req.user?.email;
        
        if (!currentUserEmail) {
            return res.status(400).json({ 
                success: false,
                error: "Current user email required" 
            });
        }
        
        console.log(`📧 Marking all messages as read for ${userType}: ${currentUserEmail}`);
        
        // Update all messages where current user is recipient to mark as read
        try {
            const updateQuery = `
                UPDATE messages 
                SET is_read = true 
                WHERE recipient_email = ?
            `;
            await client.execute(updateQuery, [currentUserEmail], { prepare: true });
            
            console.log(`✅ Marked all messages as read for ${currentUserEmail}`);
            
            return res.status(200).json({
                success: true,
                message: "All messages marked as read"
            });
            
        } catch (dbError) {
            console.error('❌ Database error marking messages as read:', dbError);
            return res.status(500).json({
                success: false,
                error: "Failed to mark messages as read"
            });
        }
        
    } catch (error) {
        console.error("❌ Error marking all messages as read:", error);
        return res.status(500).json({ 
            success: false,
            error: "Failed to mark messages as read" 
        });
    }
});

module.exports = router;
