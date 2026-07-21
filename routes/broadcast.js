const express = require("express");
const router = express.Router();
const verifyToken = require("../utils/verifyToken");
const client = require("../config/db");

// Helper function to normalize className for skills subjects
function normalizeClassName(className) {
    if (!className) return 'All Classes';
    if (className === '') return 'All Classes';
    if (className === 'All Classes') return 'All Classes';
    // For skills subjects, ensure consistent naming
    return className;
}

// POST /api/broadcast/delete-by-subject - Teacher deletes a subject/skill and its broadcast data
router.post('/delete-by-subject', verifyToken, async (req, res) => {
    try {
        const teacherEmail = req.user.email;
        const { subject, className } = req.body;
        if (!subject) {
            return res.status(400).json({ success: false, error: 'Subject is required' });
        }

        const classNameValue = className || 'All Classes';
        const classNameCandidates = [classNameValue, '', 'All Classes'];
        const now = new Date();

        // 1. Delete broadcast messages for every candidate className
        for (const cn of classNameCandidates) {
            const messagesQuery = `
                SELECT id FROM broadcast_messages_table 
                WHERE teacherEmail = ? AND className = ? AND subject = ?
            `;
            const messagesResult = await client.execute(messagesQuery, [teacherEmail, cn, subject], { prepare: true });
            if (messagesResult.rows && messagesResult.rows.length > 0) {
                const deleteMessageQuery = `
                    DELETE FROM broadcast_messages_table 
                    WHERE teacherEmail = ? AND className = ? AND subject = ? AND id = ?
                `;
                for (const row of messagesResult.rows) {
                    await client.execute(deleteMessageQuery, [teacherEmail, cn, subject, row.id], { prepare: true });
                }
            }
        }

        // 2. Delete broadcast subscription tracking rows
        for (const cn of classNameCandidates) {
            const subQuery = `
                SELECT studentEmail FROM broadcast_table 
                WHERE teacherEmail = ? AND className = ? AND subject = ?
            `;
            const subResult = await client.execute(subQuery, [teacherEmail, cn, subject], { prepare: true });
            if (subResult.rows && subResult.rows.length > 0) {
                const deleteSubQuery = `
                    DELETE FROM broadcast_table 
                    WHERE teacherEmail = ? AND className = ? AND subject = ? AND studentEmail = ?
                `;
                for (const row of subResult.rows) {
                    await client.execute(deleteSubQuery, [teacherEmail, cn, subject, row.studentemail], { prepare: true });
                }
            }
        }

        // 3. Cancel related booking requests so students no longer see the group in their broadcast tab
        const bookingQuery = `
            SELECT id, class_name FROM booking_requests 
            WHERE teacher_email = ? AND subject = ? AND status IN ('subscribed', 'accepted') 
            ALLOW FILTERING
        `;
        const bookingResult = await client.execute(bookingQuery, [teacherEmail, subject], { prepare: true });

        for (const row of bookingResult.rows || []) {
            const rowClassName = row.class_name || '';
            if (classNameCandidates.includes(rowClassName)) {
                const updateQuery = `UPDATE booking_requests SET status = 'deleted', updated_at = ? WHERE id = ?`;
                await client.execute(updateQuery, [now, row.id], { prepare: true });
            }
        }

        res.status(200).json({
            success: true,
            message: 'Broadcast data and subscriptions removed successfully'
        });

    } catch (error) {
        console.error("❌ Error deleting broadcast data:", error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to delete broadcast data',
            details: error.message 
        });
    }
});

// GET /api/broadcast/teacher-subjects - Get subjects a teacher can broadcast to
router.get("/teacher-subjects", verifyToken, async (req, res) => {
    try {
        const teacherEmail = req.user.email;
        
        // Get subjects from accepted booking requests
        const bookingQuery = `
            SELECT DISTINCT subject, className, COUNT(studentEmail) as studentCount
            FROM booking_requests 
            WHERE teacher_email = ? AND (status = 'accepted' OR status = 'subscribed')
            GROUP BY subject, className
            ALLOW FILTERING
        `;
        
        const bookingResult = await client.execute(bookingQuery, [teacherEmail], { prepare: true });
        
        // Get subjects from teacher's profile (tuitions)
        const teacherQuery = `
            SELECT tuitions FROM teachers1 WHERE email = ? LIMIT 1
        `;
        
        const teacherResult = await client.execute(teacherQuery, [teacherEmail], { prepare: true });
        
        const subjects = [];
        
        // Add subjects from booking requests with actual subscribers
        bookingResult.rows.forEach(row => {
            subjects.push({
                subject: row.subject,
                className: row.classname || 'General',
                studentCount: row.studentcount,
                source: 'subscribed',
                canBroadcast: true
            });
        });
        
        // Add subjects from teacher profile
        if (teacherResult.rows.length > 0) {
            const tuitions = JSON.parse(teacherResult.rows[0].tuitions || '[]');
            
            tuitions.forEach(tuition => {
                const skillName = tuition.skill && tuition.skill.trim();
                const subject = skillName || tuition.subject || 'General';
                const className = tuition.class || (skillName ? 'All Classes' : 'General');

                // Check if already added from bookings
                const existing = subjects.find(s =>
                    s.subject === subject &&
                    s.className === className
                );

                if (!existing) {
                    subjects.push({
                        subject,
                        className,
                        studentCount: 0,
                        source: 'profile',
                        canBroadcast: false // No subscribers yet
                    });
                }
            });
        }
        
        // Sort by student count (highest first) then by subject name
        subjects.sort((a, b) => {
            if (b.studentCount !== a.studentCount) {
                return b.studentCount - a.studentCount;
            }
            return a.subject.localeCompare(b.subject);
        });
        
        res.status(200).json({
            success: true,
            subjects: subjects,
            totalSubjects: subjects.length,
            subjectsWithSubscribers: subjects.filter(s => s.studentCount > 0).length
        });
        
    } catch (error) {
        console.error("Error fetching teacher subjects:", error);
        res.status(500).json({ error: "Failed to fetch subjects" });
    }
});

// GET /api/broadcast/subject-details/:subject/:className - Get details for a specific subject
router.get("/subject-details/:subject/:className", verifyToken, async (req, res) => {
    try {
        const { subject, className } = req.params;
        const teacherEmail = req.user.email;
        
        // Get subscribed students for this subject
        // For skills subjects, className might vary - check multiple variations
        const classNameCandidates = [className, '', 'All Classes', null];
        let studentResult = null;
        let matchedClassName = null;
        
        for (const cn of classNameCandidates) {
            const studentQuery = `
                SELECT studentEmail, studentName, created_at
                FROM booking_requests 
                WHERE teacher_email = ? AND subject = ? AND class_name = ? 
                AND (status = 'accepted' OR status = 'subscribed')
                ALLOW FILTERING
            `;
            
            const result = await client.execute(studentQuery, [teacherEmail, subject, cn], { prepare: true });
            
            if (result.rows && result.rows.length > 0) {
                studentResult = result;
                matchedClassName = cn;
                break;
            }
        }
        
        const students = studentResult.rows.map(row => ({
            email: row.student_email,
            name: row.student_name,
            subscribedAt: row.created_at
        }));
        
        // Get broadcast history for this subject - use the matched className
        const broadcastQuery = `
            SELECT id, text, timestamp, time, studentEmails
            FROM broadcast_messages_table 
            WHERE teacherEmail = ? AND subject = ? AND className = ?
            ORDER BY timestamp DESC
            LIMIT 10
        `;
        
        const broadcastResult = await client.execute(broadcastQuery, [teacherEmail, subject, matchedClassName || className], { prepare: true });
        
        const broadcasts = broadcastResult.rows.map(row => ({
            id: row.id.toString(),
            message: row.text,
            timestamp: row.timestamp,
            time: row.time,
            studentCount: JSON.parse(row.studentemails || '[]').length
        }));
        
        res.status(200).json({
            success: true,
            subject: subject,
            className: className,
            students: students,
            studentCount: students.length,
            recentBroadcasts: broadcasts,
            broadcastCount: broadcasts.length
        });
        
    } catch (error) {
        console.error("Error fetching subject details:", error);
        res.status(500).json({ error: "Failed to fetch subject details" });
    }
});

// GET /api/broadcast/groups - Get teacher's broadcast groups (detailed)
// Includes: subscribed students (with count) + accepted bookings (with 0 count) + teacher profile subjects (with 0 count)
router.get("/groups", verifyToken, async (req, res) => {
    try {
        const teacherEmail = req.user.email;
        const groupsMap = new Map();
        
        // 1. Get SUBSCRIBED students grouped by subject-class
        const subscribedQuery = `
            SELECT subject, class_name, student_email, student_name, created_at, student_info
            FROM booking_requests 
            WHERE teacher_email = ? AND status = 'subscribed'
            ALLOW FILTERING
        `;
        
        const subscribedResult = await client.execute(subscribedQuery, [teacherEmail], { prepare: true });

        const acceptedQuery = `
            SELECT subject, class_name, student_email, student_name, created_at, student_info
            FROM booking_requests 
            WHERE teacher_email = ? AND status = 'accepted'
            ALLOW FILTERING
        `;
        const acceptedResult = await client.execute(acceptedQuery, [teacherEmail], { prepare: true });
        const participantEmails = new Set([
            ...(subscribedResult.rows || []).map(row => row.student_email),
            ...(acceptedResult.rows || []).map(row => row.student_email)
        ].filter(Boolean));
        const profilePics = new Map();

        await Promise.all(Array.from(participantEmails).map(async (email) => {
            try {
                const userResult = await client.execute(
                    'SELECT profileimage FROM users WHERE email = ? LIMIT 1',
                    [email],
                    { prepare: true }
                );
                const profilePic = userResult.rows?.[0]?.profileimage;
                if (profilePic) {
                    profilePics.set(email, profilePic);
                    return;
                }

                const studentResult = await client.execute(
                    'SELECT profileimage FROM student WHERE email = ? LIMIT 1',
                    [email],
                    { prepare: true }
                );
                if (studentResult.rows?.[0]?.profileimage) {
                    profilePics.set(email, studentResult.rows[0].profileimage);
                }
            } catch (error) {
                console.warn(`⚠️ Could not fetch current profile picture for ${email}:`, error.message);
            }
        }));
        
        for (const row of subscribedResult.rows || []) {
            const subject = row.subject || 'General';
            const className = normalizeClassName(row.class_name);
            const key = `${subject}_${className}`;
            const studentInfo = row.student_info ? (typeof row.student_info === 'string' ? JSON.parse(row.student_info) : row.student_info) : {};
            
            console.log('📢 Subscribed student group:', { subject, className, key, source: 'subscribed', originalClassName: row.class_name });
            
            if (!groupsMap.has(key)) {
                groupsMap.set(key, {
                    groupId: `group_${teacherEmail}_${subject}_${className}`,
                    teacherEmail: teacherEmail,
                    subject: subject,
                    className: className,
                    boardOrUniversity: studentInfo.board || studentInfo.university || studentInfo.boardOrUniversity || '',
                    students: [],
                    studentCount: 0,
                    createdAt: row.created_at,
                    source: 'subscribed'
                });
            }
            
            const group = groupsMap.get(key);
            const profilePic = profilePics.get(row.student_email) || null;
            group.students.push({
                email: row.student_email,
                name: row.student_name,
                profilePic,
                joinedAt: row.created_at,
                status: 'subscribed'
            });
            group.studentCount = group.students.length;
        }
        
        // 2. Get ACCEPTED bookings (student will complete payment) - show with 0 count
        for (const row of acceptedResult.rows || []) {
            const subject = row.subject || 'General';
            const className = normalizeClassName(row.class_name);
            const key = `${subject}_${className}`;
            const studentInfo = row.student_info ? (typeof row.student_info === 'string' ? JSON.parse(row.student_info) : row.student_info) : {};
            
            console.log('📢 Accepted student group:', { subject, className, key, source: 'accepted', originalClassName: row.class_name });
            
            if (!groupsMap.has(key)) {
                // Create group with 0 students initially
                groupsMap.set(key, {
                    groupId: `group_${teacherEmail}_${subject}_${className}`,
                    teacherEmail: teacherEmail,
                    subject: subject,
                    className: className,
                    boardOrUniversity: studentInfo.board || studentInfo.university || studentInfo.boardOrUniversity || '',
                    students: [],
                    studentCount: 0,
                    createdAt: row.created_at,
                    source: 'accepted',
                    pendingStudents: []
                });
            }
            
            const group = groupsMap.get(key);
            // Add to pending students list (will complete payment)
            group.pendingStudents = group.pendingStudents || [];
            const profilePic = profilePics.get(row.student_email) || null;
            group.pendingStudents.push({
                email: row.student_email,
                name: row.student_name,
                profilePic,
                acceptedAt: row.created_at,
                status: 'accepted'
            });
            
            // Update source if not already subscribed
            if (group.source !== 'subscribed') {
                group.source = 'accepted';
            }
        }
        
        // 3. Get teacher's profile subjects (tuitions) - always show with 0 count for potential
        const teacherQuery = `
            SELECT tuitions FROM teachers1 WHERE email = ? LIMIT 1
        `;
        
        const teacherResult = await client.execute(teacherQuery, [teacherEmail], { prepare: true });
        
        if (teacherResult.rows.length > 0) {
            const tuitions = JSON.parse(teacherResult.rows[0].tuitions || '[]');
            
            for (const tuition of tuitions) {
                const skillName = tuition.skill && tuition.skill.trim();
                const subject = skillName || tuition.subject || 'General';
                const isUniversity = tuition.board === 'Universities';
                const className = skillName
                    ? (tuition.class || 'All Classes')
                    : (isUniversity
                        ? `${tuition.university} (${tuition.year})`
                        : (tuition.class || tuition.className || 'All Classes'));
                const boardOrUniversity = isUniversity
                    ? (tuition.university || '')
                    : (tuition.board || '');
                const key = `${subject}_${className}`;
                
                // Only add if group doesn't exist (don't overwrite subscribed/accepted)
                if (!groupsMap.has(key)) {
                    console.log('📢 Adding profile group:', { subject, className, key, source: 'profile' });
                    groupsMap.set(key, {
                        groupId: `group_${teacherEmail}_${subject}_${className}`,
                        teacherEmail: teacherEmail,
                        subject: subject,
                        className: className,
                        boardOrUniversity: boardOrUniversity,
                        students: [],
                        studentCount: 0,
                        createdAt: new Date(),
                        source: 'profile',
                        pendingStudents: []
                    });
                }
            }
        }
        
        const groups = Array.from(groupsMap.values());
        const totalStudents = groups.reduce((sum, g) => sum + g.studentCount, 0);
        const totalPending = groups.reduce((sum, g) => sum + (g.pendingStudents?.length || 0), 0);
        
        res.status(200).json({
            success: true,
            groups: groups,
            totalGroups: groups.length,
            totalStudents: totalStudents,
            totalPending: totalPending,
            groupsWithSubscribers: groups.filter(g => g.studentCount > 0).length,
            groupsWithAccepted: groups.filter(g => g.pendingStudents && g.pendingStudents.length > 0).length
        });
        
    } catch (error) {
        console.error("❌ Error fetching broadcast groups:", error);
        res.status(500).json({ 
            success: false,
            error: "Failed to fetch broadcast groups" 
        });
    }
});

// GET /api/broadcast/student-subscriptions - Get student's broadcast subscriptions
router.get("/student-subscriptions", verifyToken, async (req, res) => {
    try {
        const studentEmail = req.user.email;
        
        // Get student's subscribed teachers
        const query = `
            SELECT teacher_email, subject, class_name, student_info
            FROM booking_requests 
            WHERE student_email = ? AND status = ?
            ALLOW FILTERING
        `;
        
        const result = await client.execute(query, [studentEmail, 'subscribed'], { prepare: true });
        
        if (!result.rows || result.rows.length === 0) {
            return res.status(200).json({
                success: true,
                subscriptions: [],
                totalSubscriptions: 0
            });
        }
        
        // Get teacher details for each subscription
        const subscriptions = [];
        
        for (const row of result.rows) {
            const teacherQuery = `
                SELECT name, profilepic FROM teachers1 
                WHERE email = ? 
                LIMIT 1
            `;
            const teacherResult = await client.execute(teacherQuery, [row.teacher_email], { prepare: true });
            const teacher = teacherResult.rows?.[0];
            
            // Parse student_info from JSON string if needed
            let studentInfo = {};
            try {
                if (row.student_info) {
                    studentInfo = typeof row.student_info === 'string' 
                        ? JSON.parse(row.student_info) 
                        : row.student_info;
                }
            } catch (e) {
                console.warn('Failed to parse student_info:', e);
            }
            
            // Get recent broadcasts for this group (fetch and sort in JS since Cassandra doesn't support ORDER BY on non-clustering columns)
            // For skills subjects, className might vary - check multiple variations
            const classNameCandidates = [row.class_name, '', 'All Classes'].filter(cn => cn !== null && cn !== undefined);
            let broadcastResult = null;
            
            for (const cn of classNameCandidates) {
                const broadcastQuery = `
                    SELECT id, text, timestamp, teacherName
                    FROM broadcast_messages_table 
                    WHERE teacherEmail = ? AND subject = ? AND className = ?
                    LIMIT 10
                `;
                
                const result = await client.execute(broadcastQuery, [
                    row.teacher_email, 
                    row.subject, 
                    cn
                ], { prepare: true });
                
                if (result.rows && result.rows.length > 0) {
                    broadcastResult = result;
                    break;
                }
            }
            
            // Sort by timestamp in JavaScript to get the most recent
            const broadcasts = (broadcastResult && broadcastResult.rows) ? broadcastResult.rows : [];
            const sortedBroadcasts = broadcasts.sort((a, b) => {
                const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
                const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
                return timeB - timeA; // Descending order
            });
            const lastBroadcast = sortedBroadcasts[0];
            
            const normalizedClassName = normalizeClassName(row.class_name);
            subscriptions.push({
                groupId: `group_${row.teacher_email}_${row.subject}_${normalizedClassName}`,
                teacherEmail: row.teacher_email,
                teacherName: teacher?.name || row.teacher_email,
                teacherProfilePic: teacher?.profilepic || null,
                subject: row.subject,
                className: normalizedClassName,
                boardOrUniversity: studentInfo?.board || studentInfo?.university || '',
                lastBroadcast: lastBroadcast ? {
                    id: lastBroadcast.id?.toString(),
                    text: lastBroadcast.text,
                    timestamp: lastBroadcast.timestamp,
                    teacherName: lastBroadcast.teachername
                } : null
            });
            
            console.log('📢 Student subscription:', {
                groupId: `group_${row.teacher_email}_${row.subject}_${normalizedClassName}`,
                subject: row.subject,
                className: normalizedClassName,
                originalClassName: row.class_name
            });
        }
        
        res.status(200).json({
            success: true,
            subscriptions: subscriptions,
            totalSubscriptions: subscriptions.length
        });
        
    } catch (error) {
        console.error("❌ Error fetching student subscriptions:", error);
        res.status(500).json({ 
            success: false,
            error: "Failed to fetch subscriptions" 
        });
    }
});

// POST /api/broadcast/send - Send a broadcast message
router.post("/send", verifyToken, async (req, res) => {
    try {
        const teacherEmail = req.user.email;
        const { groupId, subject, className, text, boardOrUniversity } = req.body;

        if (!text || (!groupId && (!subject || !className))) {
            return res.status(400).json({
                success: false,
                error: "Text and either groupId or subject+className are required"
            });
        }

        // Parse subject and className from groupId if not provided directly
        let subjectName = subject;
        let classNameValue = className;
        if (groupId && (!subjectName || !classNameValue)) {
            const afterPrefix = groupId.substring(6);
            const emailMatch = afterPrefix.match(/^(.+?@.+\..+)_(.+)$/);
            if (emailMatch) {
                const parts = emailMatch[2].split('_');
                if (parts.length >= 2) {
                    subjectName = subjectName || parts[0];
                    classNameValue = classNameValue || parts.slice(1).join('_');
                }
            }
        }
        classNameValue = normalizeClassName(classNameValue);

        if (!subjectName || !classNameValue) {
            return res.status(400).json({ success: false, error: "Could not determine subject and className" });
        }

        // Fetch subscribed students — try className variations
        const classNameCandidates = [classNameValue, '', 'All Classes', null];
        let studentResult = null;
        let matchedClassName = null;

        for (const cn of classNameCandidates) {
            const result = await client.execute(
                `SELECT student_email, student_name FROM booking_requests 
                 WHERE teacher_email = ? AND subject = ? AND class_name = ? AND status = ? ALLOW FILTERING`,
                [teacherEmail, subjectName, cn, 'subscribed'],
                { prepare: true }
            );
            if (result.rows && result.rows.length > 0) {
                studentResult = result;
                matchedClassName = cn;
                break;
            }
        }

        if (!studentResult || studentResult.rows.length === 0) {
            return res.status(400).json({ success: false, error: "No subscribed students in this group" });
        }

        const { v1: uuidv1 } = require('uuid');
        const messageId = uuidv1();
        const timestamp = new Date();
        const resolvedGroupId = groupId || `group_${teacherEmail}_${subjectName}_${classNameValue}`;
        const studentEmails = studentResult.rows.map(s => s.student_email);
        const studentNames = studentResult.rows.map(s => s.student_name).join(', ');

        // Persist to DB first to ensure message is saved
        await client.execute(
            `INSERT INTO broadcast_messages_table 
             (teacherEmail, className, subject, id, studentEmails, studentNames, isBroadcast, sender, teacherName, text, time, timestamp) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                teacherEmail,
                matchedClassName || classNameValue,
                subjectName,
                messageId,
                JSON.stringify(studentEmails),
                studentNames,
                true,
                teacherEmail,
                req.user.name || teacherEmail,
                text,
                timestamp.toLocaleTimeString(),
                timestamp
            ],
            { prepare: true }
        );

        const broadcastPayload = {
            messageId,
            groupId: resolvedGroupId,
            teacherEmail,
            teacherName: req.user.name || teacherEmail,
            text,
            timestamp: timestamp.toISOString(),
            subject: subjectName,
            classOrYear: matchedClassName || classNameValue,
            boardOrUniversity: boardOrUniversity || '',
            isBroadcast: true
        };

        // Emit via WebSocket for real-time delivery
        try {
            const io = require('../socket').getIO();
            if (io) {
                studentEmails.forEach(email => {
                    io.to(`user:${email}`).emit('new_broadcast', broadcastPayload);
                });
                io.to(`broadcast:${resolvedGroupId}`).emit('new_broadcast', broadcastPayload);
            }
        } catch (socketErr) {
            console.warn('⚠️ Socket emit failed:', socketErr.message);
        }

        res.status(200).json({
            success: true,
            message: "Broadcast sent successfully",
            messageId,
            recipientCount: studentEmails.length,
            groupId: resolvedGroupId,
            subject: subjectName,
            className: matchedClassName || classNameValue
        });

    } catch (error) {
        console.error("❌ Error sending broadcast:", error);
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: "Failed to send broadcast" });
        }
    }
});

// GET /api/broadcast/history/:teacherEmail/:subject/:className - Get broadcast history
router.get("/history/:teacherEmail/:subject/:className", verifyToken, async (req, res) => {
    try {
        const { teacherEmail, subject, className } = req.params;
        const studentEmail = req.user.email;
        
        // Verify student is subscribed to this group
        // For skills subjects, className might vary - check multiple variations
        const classNameCandidates = [className, '', 'All Classes', null];
        let checkResult = null;
        let matchedClassName = null;
        
        for (const cn of classNameCandidates) {
            const checkQuery = `
                SELECT * FROM booking_requests 
                WHERE student_email = ? AND teacher_email = ? AND subject = ? AND class_name = ? AND status = ?
                ALLOW FILTERING
            `;
            
            const result = await client.execute(checkQuery, [
                studentEmail, teacherEmail, subject, cn, 'subscribed'
            ], { prepare: true });
            
            if (result.rows && result.rows.length > 0) {
                checkResult = result;
                matchedClassName = cn;
                break;
            }
        }
        
        if (!checkResult || !checkResult.rows || checkResult.rows.length === 0) {
            return res.status(403).json({
                success: false,
                error: "You are not subscribed to this broadcast group"
            });
        }
        
        // Get broadcast messages - use the matched className
        // Note: Cannot use ORDER BY on timestamp as it's not a clustering column
        const query = `
            SELECT id, text, timestamp, time, teacherName, sender
            FROM broadcast_messages_table 
            WHERE teacherEmail = ? AND subject = ? AND className = ?
            LIMIT 50
        `;
        
        const result = await client.execute(query, [teacherEmail, subject, matchedClassName || className], { prepare: true });
        
        const messages = result.rows?.map(row => ({
            id: row.id?.toString(),
            text: row.text,
            timestamp: row.timestamp,
            time: row.time,
            teacherName: row.teachername,
            sender: row.sender,
            isBroadcast: true
        })).sort((a, b) => {
            // Sort by timestamp descending (newest first)
            const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            return timeB - timeA;
        }) || [];
        
        res.status(200).json({
            success: true,
            messages: messages,
            count: messages.length
        });
        
    } catch (error) {
        console.error("❌ Error fetching broadcast history:", error);
        res.status(500).json({ 
            success: false,
            error: "Failed to fetch broadcast history" 
        });
    }
});

// GET /api/broadcast/teacher-history/:subject/:className - Get teacher's own broadcast history
router.get("/teacher-history/:subject/:className", verifyToken, async (req, res) => {
    try {
        const teacherEmail = req.user.email;
        const { subject, className } = req.params;
        
        // Verify this is a teacher
        const userQuery = "SELECT role FROM users WHERE email = ? ALLOW FILTERING";
        const userResult = await client.execute(userQuery, [teacherEmail], { prepare: true });
        
        if (!userResult.rows || userResult.rows.length === 0 || userResult.rows[0].role !== 'teacher') {
            return res.status(403).json({
                success: false,
                error: "Only teachers can access this endpoint"
            });
        }
        
        // Get broadcast messages sent by this teacher for this subject-class
        // For skills subjects, className might vary - check multiple variations
        const classNameCandidates = [className, '', 'All Classes', null];
        let result = null;
        
        for (const cn of classNameCandidates) {
            const query = `
                SELECT id, text, timestamp, time, teacherName, sender, studentEmails
                FROM broadcast_messages_table 
                WHERE teacherEmail = ? AND subject = ? AND className = ?
                LIMIT 50
            `;
            
            const queryResult = await client.execute(query, [teacherEmail, subject, cn], { prepare: true });
            
            if (queryResult.rows && queryResult.rows.length > 0) {
                result = queryResult;
                break;
            }
        }
        
        const messages = result.rows?.map(row => {
            let recipientCount = 0;
            try {
                const emailsStr = row.studentemails || row.studentEmails;
                if (emailsStr) {
                    recipientCount = JSON.parse(emailsStr).length;
                }
            } catch (parseError) {
                console.warn('⚠️ Could not parse studentemails:', parseError.message);
            }
            
            return {
                id: row.id?.toString(),
                text: row.text,
                timestamp: row.timestamp,
                time: row.time,
                teacherName: row.teachername || row.teacherName,
                sender: row.sender,
                isBroadcast: true,
                recipientCount: recipientCount
            };
        }).sort((a, b) => {
            // Sort by timestamp descending (newest first)
            const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            return timeB - timeA;
        }) || [];
        
        res.status(200).json({
            success: true,
            messages: messages,
            count: messages.length
        });
        
    } catch (error) {
        console.error("❌ Error fetching teacher broadcast history:", error);
        res.status(500).json({ 
            success: false,
            error: "Failed to fetch broadcast history",
            details: error.message 
        });
    }
});

// GET /api/broadcasts/new-count - Get new broadcast message count for current user
router.get('/new-count', verifyToken, async (req, res) => {
    try {
        const userEmail = req.user.email;
        const userRole = req.user.role;
        
        console.log(`🔢 Getting new broadcast count for ${userRole}: ${userEmail}`);
        
        let newCount = 0;
        
        if (userRole === 'student') {
            // For students, count broadcasts from teachers they're subscribed to
            // that they haven't read yet (simplified - counts all recent broadcasts)
            const subscriptionQuery = `
                SELECT teacher_email, subject, class_name
                FROM booking_requests 
                WHERE student_email = ? AND status = ?
                ALLOW FILTERING
            `;
            
            const subscriptionResult = await client.execute(subscriptionQuery, [userEmail, 'subscribed'], { prepare: true });
            
            if (subscriptionResult.rows && subscriptionResult.rows.length > 0) {
                // Count recent broadcasts from subscribed teachers
                for (const subscription of subscriptionResult.rows) {
                    const broadcastQuery = `
                        SELECT COUNT(*) as count
                        FROM broadcast_messages_table 
                        WHERE teacherEmail = ? AND subject = ? AND className = ?
                        AND timestamp > ?
                    `;
                    
                    // Count broadcasts from last 7 days as "new"
                    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                    
                    try {
                        const broadcastResult = await client.execute(broadcastQuery, [
                            subscription.teacher_email,
                            subscription.subject,
                            subscription.class_name
                        ], { prepare: true });
                        
                        if (broadcastResult.rows && broadcastResult.rows.length > 0) {
                            newCount += broadcastResult.rows[0].count || 0;
                        }
                    } catch (err) {
                        console.warn(`Error counting broadcasts for ${subscription.teacher_email}:`, err.message);
                    }
                }
            }
            
        } else if (userRole === 'teacher') {
            // For teachers, count broadcasts they sent in the last 24 hours
            const teacherQuery = `
                SELECT COUNT(*) as count
                FROM broadcast_messages_table 
                WHERE teacherEmail = ? AND timestamp > ?
            `;
            
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            
            try {
                const teacherResult = await client.execute(teacherQuery, [userEmail], { prepare: true });
                
                if (teacherResult.rows && teacherResult.rows.length > 0) {
                    newCount = teacherResult.rows[0].count || 0;
                }
            } catch (err) {
                console.warn(`Error counting teacher broadcasts:`, err.message);
            }
        }
        
        console.log(`✅ New broadcast count for ${userEmail}: ${newCount}`);
        
        return res.status(200).json({
            success: true,
            newCount: newCount,
            userRole: userRole
        });
        
    } catch (error) {
        console.error("❌ Error getting new broadcast count:", error);
        return res.status(500).json({ 
            success: false,
            error: "Failed to get new broadcast count" 
        });
    }
});

module.exports = router;
