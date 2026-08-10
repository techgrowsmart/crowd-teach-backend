/**
 * Socket Chat Service - Real-time messaging and broadcast system
 * Handles individual chat and broadcast messaging for teachers and students
 */

const { getIO, getConnectedUsers, connectedUsers } = require('../socket');
const client = require('../config/db');
const { v1: uuidv1 } = require('uuid');

// In-memory stores for active chats and broadcast groups
const activeChats = new Map(); // chatId -> { participants: [], messages: [] }
const broadcastGroups = new Map(); // groupId -> { teacherEmail, subject, className, boardOrUniversity, students: [] }
const typingUsers = new Map(); // chatId -> Set of typing users

// OPTIMIZATION: In-memory message cache for instant delivery
const messageCache = new Map(); // chatId -> messages array
const CACHE_SIZE_LIMIT = 1000; // Limit cache size

// Performance metrics tracking
const performanceMetrics = {
  messageDeliveryTimes: [],
  cacheHitCount: 0,
  cacheMissCount: 0
};

// Performance monitoring function
function trackMessageDelivery(startTime, messageId, senderEmail, recipientEmail) {
  const endTime = process.hrtime.bigint();
  const durationNs = Number(endTime - startTime);
  const durationMs = durationNs / 1000000;
  
  performanceMetrics.messageDeliveryTimes.push({
    messageId,
    senderEmail,
    recipientEmail,
    durationNs,
    durationMs,
    timestamp: new Date()
  });
  
  // Keep only last 100 metrics
  if (performanceMetrics.messageDeliveryTimes.length > 100) {
    performanceMetrics.messageDeliveryTimes.shift();
  }
  
  console.log(`⚡ Message ${messageId} delivered in ${durationNs} nanoseconds (${durationMs.toFixed(3)}ms)`);
  
  // Log if delivery exceeds 1ms (1000000 nanoseconds)
  if (durationNs > 1000000) {
    console.warn(`⚠️ Slow message delivery detected: ${durationNs}ns`);
  }
  
  return durationNs;
}

// Get performance metrics
function getPerformanceMetrics() {
  const avgDeliveryTime = performanceMetrics.messageDeliveryTimes.length > 0 
    ? performanceMetrics.messageDeliveryTimes.reduce((sum, m) => sum + m.durationNs, 0) / performanceMetrics.messageDeliveryTimes.length
    : 0;
    
  const cacheHitRate = performanceMetrics.cacheHitCount + performanceMetrics.cacheMissCount > 0
    ? (performanceMetrics.cacheHitCount / (performanceMetrics.cacheHitCount + performanceMetrics.cacheMissCount)) * 100
    : 0;
    
  return {
    averageDeliveryTimeNs: Math.round(avgDeliveryTime),
    averageDeliveryTimeMs: (avgDeliveryTime / 1000000).toFixed(3),
    totalMessages: performanceMetrics.messageDeliveryTimes.length,
    cacheHitRate: cacheHitRate.toFixed(2) + '%',
    cacheHits: performanceMetrics.cacheHitCount,
    cacheMisses: performanceMetrics.cacheMissCount
  };
}

/**
 * Initialize chat and broadcast socket handlers
 * @param {Socket} socket - Individual socket instance
 * @param {string} email - User email
 * @param {string} role - User role (student/teacher)
 */
function initChatSocket(socket, email, role) {
  console.log(`💬 Initializing chat socket for ${email} (${role})`);

  // ============ INDIVIDUAL CHAT HANDLERS ============

  // Join a chat room - OPTIMIZED
  socket.on('join_chat', async (data) => {
    try {
      const { contactEmail, subject, class_name, boardOrUniversity, contactTitle } = data;
      if (!contactEmail) {
        socket.emit('chat_error', { error: 'Contact email required' });
        return;
      }

      // Create context-aware chat ID to support subject-specific conversations
      // Prefer the full contactTitle (matches /send and /:contactEmail routes)
      const contextParts = [email, contactEmail];
      if (contactTitle) {
        contextParts.push(contactTitle.toLowerCase().trim().replace(/\s+/g, '_'));
      } else {
        if (subject) contextParts.push(subject.toLowerCase().replace(/\s+/g, '_'));
        if (class_name) contextParts.push(class_name.toLowerCase().replace(/\s+/g, '_'));
        if (boardOrUniversity) contextParts.push(boardOrUniversity.toLowerCase().replace(/\s+/g, '_'));
      }
      
      const chatId = contextParts.sort().join('_');
      socket.join(`chat:${chatId}`);
      
      console.log(`👥 ${email} joined chat room: ${chatId} with context:`, { subject, class_name, boardOrUniversity });
      
      // OPTIMIZATION: Check cache first for instant chat history
      let chatHistory = messageCache.get(chatId);
      
      if (chatHistory) {
        performanceMetrics.cacheHitCount++;
        console.log(`⚡ Chat history from CACHE for ${chatId}`);
        socket.emit('chat_history', {
          chatId,
          contactEmail,
          messages: chatHistory,
          fromCache: true,
          subject: subject || null,
          className: class_name || null,
          boardOrUniversity: boardOrUniversity || null
        });
      } else {
        performanceMetrics.cacheMissCount++;
        // Fetch from database if not in cache
        chatHistory = await getChatHistory(chatId, email, contactEmail, subject, class_name, boardOrUniversity);
        
        // Cache the results for future instant access
        if (chatHistory.length > 0) {
          messageCache.set(chatId, chatHistory);
          // Manage cache size
          if (messageCache.size > CACHE_SIZE_LIMIT) {
            const firstKey = messageCache.keys().next().value;
            messageCache.delete(firstKey);
          }
        }
        
        socket.emit('chat_history', {
          chatId,
          contactEmail,
          messages: chatHistory,
          fromCache: false,
          subject: subject || null,
          className: class_name || null,
          boardOrUniversity: boardOrUniversity || null
        });
      }
    } catch (error) {
      console.error('❌ Error joining chat:', error);
      socket.emit('chat_error', { error: 'Failed to join chat' });
    }
  });

  // Leave a chat room
  socket.on('leave_chat', (data) => {
    const { contactEmail, subject, class_name, boardOrUniversity } = data;
    if (contactEmail) {
      // Create context-aware chat ID
      const contextParts = [email, contactEmail];
      if (subject) contextParts.push(subject.toLowerCase().replace(/\s+/g, '_'));
      if (class_name) contextParts.push(class_name.toLowerCase().replace(/\s+/g, '_'));
      if (boardOrUniversity) contextParts.push(boardOrUniversity.toLowerCase().replace(/\s+/g, '_'));
      
      const chatId = contextParts.sort().join('_');
      socket.leave(`chat:${chatId}`);
      console.log(`👋 ${email} left chat room: ${chatId}`);
    }
  });

  // Send a message - OPTIMIZED FOR LIGHTNING FAST DELIVERY
  socket.on('send_message', async (data) => {
    const startTime = process.hrtime.bigint();
    
    try {
      const { recipientEmail, text, senderName, encrypted, publicKey, messageHash, subject, class_name, boardOrUniversity, contactTitle } = data;
      
      if (!recipientEmail || !text) {
        socket.emit('message_error', { error: 'Recipient and text required' });
        return;
      }

      // Create context-aware chat ID to support subject-specific conversations.
      // Prefer contactTitle (full tuition title) as it uniquely captures details
      // that subject/class/board alone don't (e.g. university year).
      const contextParts = [email, recipientEmail];
      if (contactTitle) {
        contextParts.push(contactTitle.toLowerCase().trim().replace(/\s+/g, '_'));
      } else {
        if (subject) contextParts.push(subject.toLowerCase().replace(/\s+/g, '_'));
        if (class_name) contextParts.push(class_name.toLowerCase().replace(/\s+/g, '_'));
        if (boardOrUniversity) contextParts.push(boardOrUniversity.toLowerCase().replace(/\s+/g, '_'));
      }
      
      const chatId = contextParts.sort().join('_');
      const messageId = uuidv1();
      const timestamp = new Date();

      // Prepare message for IMMEDIATE emission
      const messagePayload = {
        messageId,
        chatId,
        senderEmail: email,
        recipientEmail,
        text,
        senderName: senderName || email,
        timestamp: timestamp.getTime(),
        isRead: false,
        deliveredAt: Date.now(),
        encrypted: encrypted === true,
        publicKey: publicKey || null,
        messageHash: messageHash || null,
        subject: subject || null,
        className: class_name || null,
        boardOrUniversity: boardOrUniversity || null,
        contactTitle: contactTitle || null
      };

      const io = getIO();
      
      // OPTIMIZATION 1: Send to recipient IMMEDIATELY without waiting for database
      const recipientSocket = io.sockets.sockets.get(connectedUsers.get(recipientEmail)?.socketId);
      if (recipientSocket && recipientSocket.connected) {
        recipientSocket.emit('new_message', messagePayload);
        console.log(`⚡ Message delivered INSTANTLY to ${recipientEmail}`);
      } else {
        // Fallback to room-based delivery
        io.to(`user:${recipientEmail}`).emit('new_message', messagePayload);
      }

      // Send to sender immediately
      socket.emit('message_sent', messagePayload);

      const emitTime = process.hrtime.bigint();
      const emitDurationNs = trackMessageDelivery(startTime, messageId, email, recipientEmail);

      // OPTIMIZATION 2: Async database write (non-blocking)
      // Use setImmediate to prevent blocking the event loop
      setImmediate(async () => {
        try {
          const query = `
            INSERT INTO messages 
            (id, sender_email, recipient_email, text, timestamp, is_read, chat_id, created_at, sender_name, recipient_name, encrypted, public_key, message_hash, subject, class_name, board_or_university, title) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;
          await client.execute(query, [
            messageId,
            email,
            recipientEmail,
            text,
            timestamp,
            false,
            chatId,
            timestamp,
            senderName || email,
            recipientEmail,
            encrypted === true,
            publicKey || null,
            messageHash || null,
            subject || null,
            class_name || null,
            boardOrUniversity || null,
            contactTitle || null
          ], { prepare: true });
          
          const dbTime = process.hrtime.bigint();
          const totalDurationNs = Number(dbTime - startTime);
          console.log(`💾 Database save completed. Total time: ${totalDurationNs} nanoseconds (${totalDurationNs / 1000000}ms)`);
        } catch (dbError) {
          console.error('❌ Error saving message to database (async):', dbError);
          // Message already delivered, so just log the error
        }
      });

      // OPTIMIZATION 3: Save contact record when a message is actually sent.
      // This is the ONLY point where contacts are created; no booking/status event creates a contact.
      setImmediate(async () => {
        try {
          let teacherEmail, studentEmail;
          const senderRoleResult = await client.execute(
            'SELECT role FROM users WHERE email = ? LIMIT 1',
            [email],
            { prepare: true }
          );
          const senderIsStudent = senderRoleResult.rows && senderRoleResult.rows.length > 0 &&
                                  senderRoleResult.rows[0].role === 'student';
          if (senderIsStudent) {
            teacherEmail = recipientEmail;
            studentEmail = email;
          } else {
            teacherEmail = email;
            studentEmail = recipientEmail;
          }

          const existingContactQuery = contactTitle
            ? `SELECT * FROM contacts WHERE teacher_email = ? AND student_email = ? AND title = ? ALLOW FILTERING LIMIT 1`
            : `SELECT * FROM contacts WHERE teacher_email = ? AND student_email = ? AND subject = ? AND class_name = ? AND board_or_university = ? ALLOW FILTERING LIMIT 1`;
          const existingParams = contactTitle
            ? [teacherEmail, studentEmail, contactTitle]
            : [teacherEmail, studentEmail, subject || null, class_name || null, boardOrUniversity || null];
          const existing = await client.execute(existingContactQuery, existingParams, { prepare: true });

          if (!existing.rows || existing.rows.length === 0) {
            const teacherResult = await client.execute(
              'SELECT name, profileimage FROM users WHERE email = ? LIMIT 1',
              [teacherEmail],
              { prepare: true }
            );
            const studentResult = await client.execute(
              'SELECT name, profileimage FROM users WHERE email = ? LIMIT 1',
              [studentEmail],
              { prepare: true }
            );

            const teacherName = teacherResult.rows?.[0]?.name || teacherEmail.split('@')[0];
            const teacherProfilePic = teacherResult.rows?.[0]?.profileimage || null;
            const studentName = studentResult.rows?.[0]?.name || studentEmail.split('@')[0];
            const studentProfilePic = studentResult.rows?.[0]?.profileimage || null;

            const titlePart = contactTitle ? contactTitle.replace(/[^a-zA-Z0-9]/g, '_') : null;
            const subjectPart = (subject || 'General').replace(/[^a-zA-Z0-9]/g, '_');
            const classPart = (class_name || 'General').replace(/[^a-zA-Z0-9]/g, '_');
            const boardPart = (boardOrUniversity || '').replace(/[^a-zA-Z0-9]/g, '_');
            const contactId = titlePart
              ? `contact_${teacherEmail}_${studentEmail}_${titlePart}`
              : `contact_${teacherEmail}_${studentEmail}_${subjectPart}_${classPart}_${boardPart}`;

            const insertQuery = `
              INSERT INTO contacts (
                id, teacher_email, student_email, teacher_name, student_name,
                teacher_profile_pic, student_profile_pic, subject, class_name, board_or_university, title, status, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;
            await client.execute(insertQuery, [
              contactId,
              teacherEmail,
              studentEmail,
              teacherName,
              studentName,
              teacherProfilePic,
              studentProfilePic,
              subject || null,
              class_name || null,
              boardOrUniversity || null,
              contactTitle || null,
              'accepted',
              new Date(),
              new Date()
            ], { prepare: true });

            console.log('✅ Socket contact saved:', contactId, 'title:', contactTitle || subject || 'General');
          }
        } catch (contactError) {
          console.warn('⚠️ Socket contact save failed (non-critical):', contactError.message);
          // Don’t fail the message if contact creation fails
        }
      });

      // OPTIMIZATION 4: Update cache immediately after message delivery
      setImmediate(() => {
        if (!messageCache.has(chatId)) {
          messageCache.set(chatId, []);
        }
        const cachedMessages = messageCache.get(chatId);
        cachedMessages.push(messagePayload);
        
        // Keep only last 50 messages in cache to manage memory
        if (cachedMessages.length > 50) {
          cachedMessages.splice(0, cachedMessages.length - 50);
        }
      });

      console.log(`⚡ Message sent from ${email} to ${recipientEmail} - DELIVERED INSTANTLY`);
    } catch (error) {
      console.error('❌ Error sending message:', error);
      socket.emit('message_error', { error: 'Failed to send message' });
    }
  });

  // Mark messages as read
  socket.on('mark_as_read', async (data) => {
    const { contactEmail, subject, class_name, boardOrUniversity } = data;
    if (contactEmail) {
      // Create context-aware chat ID
      const contextParts = [email, contactEmail];
      if (subject) contextParts.push(subject.toLowerCase().replace(/\s+/g, '_'));
      if (class_name) contextParts.push(class_name.toLowerCase().replace(/\s+/g, '_'));
      if (boardOrUniversity) contextParts.push(boardOrUniversity.toLowerCase().replace(/\s+/g, '_'));
      
      const chatId = contextParts.sort().join('_');
      const io = getIO();
      io.to(`user:${contactEmail}`).emit('messages_read', {
        chatId,
        by: email
      });
    }
  });

  // Typing indicators
  socket.on('typing', (data) => {
    const { recipientEmail, subject, class_name, boardOrUniversity } = data;
    if (recipientEmail) {
      // Create context-aware chat ID
      const contextParts = [email, recipientEmail];
      if (subject) contextParts.push(subject.toLowerCase().replace(/\s+/g, '_'));
      if (class_name) contextParts.push(class_name.toLowerCase().replace(/\s+/g, '_'));
      if (boardOrUniversity) contextParts.push(boardOrUniversity.toLowerCase().replace(/\s+/g, '_'));
      
      const chatId = contextParts.sort().join('_');
      const io = getIO();
      io.to(`user:${recipientEmail}`).emit('typing', {
        from: email,
        fromName: socket.userName || email,
        chatId
      });
    }
  });

  socket.on('stop_typing', (data) => {
    const { recipientEmail, subject, class_name, boardOrUniversity } = data;
    if (recipientEmail) {
      // Create context-aware chat ID
      const contextParts = [email, recipientEmail];
      if (subject) contextParts.push(subject.toLowerCase().replace(/\s+/g, '_'));
      if (class_name) contextParts.push(class_name.toLowerCase().replace(/\s+/g, '_'));
      if (boardOrUniversity) contextParts.push(boardOrUniversity.toLowerCase().replace(/\s+/g, '_'));
      
      const chatId = contextParts.sort().join('_');
      const io = getIO();
      io.to(`user:${recipientEmail}`).emit('stop_typing', {
        from: email,
        chatId
      });
    }
  });

  // ============ BROADCAST HANDLERS ============

  // Get broadcast groups for teacher (based on subscribed students)
  socket.on('get_broadcast_groups', async () => {
    try {
      if (role !== 'teacher') {
        socket.emit('broadcast_error', { error: 'Only teachers can access broadcast groups' });
        return;
      }

      const groups = await getTeacherBroadcastGroups(email);
      socket.emit('broadcast_groups', { groups });
      console.log(`📢 Sent ${groups.length} broadcast groups to teacher ${email}`);
    } catch (error) {
      console.error('❌ Error getting broadcast groups:', error);
      socket.emit('broadcast_error', { error: 'Failed to get broadcast groups' });
    }
  });

  // Send broadcast message
  socket.on('send_broadcast', async (data) => {
    try {
      const { groupId, text, boardOrUniversity, classOrYear, subject } = data;
      
      if (role !== 'teacher') {
        socket.emit('broadcast_error', { error: 'Only teachers can send broadcasts' });
        return;
      }

      if (!groupId || !text) {
        socket.emit('broadcast_error', { error: 'Group ID and text required' });
        return;
      }

      // Parse group ID to get subject and class info
      const groupInfo = parseGroupId(groupId);
      console.log('📢 Parsed groupId:', groupId);
      console.log('📢 Parsed groupInfo:', groupInfo);
      
      // Get subscribed students for this group
      const students = await getSubscribedStudentsForGroup(email, groupInfo);
      console.log(`📢 Found ${students.length} subscribed students for ${groupInfo.subject} - ${groupInfo.className}`);
      
      if (students.length === 0) {
        socket.emit('broadcast_error', { error: 'No subscribed students in this group' });
        return;
      }

      const messageId = `broadcast_${uuidv1()}`;
      const timestamp = new Date();

      // Store broadcast message in database
      try {
        const query = `
          INSERT INTO broadcast_messages_table 
          (teacherEmail, className, subject, id, studentEmails, studentNames, isBroadcast, sender, teacherName, text, time, timestamp) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        
        const studentEmails = students.map(s => s.email);
        const studentNames = students.map(s => s.name).join(', ');
        
        await client.execute(query, [
          email,
          groupInfo.className || classOrYear || '',
          groupInfo.subject || subject || '',
          uuidv1(),
          JSON.stringify(studentEmails),
          studentNames,
          true,
          email,
          socket.userName || email,
          text,
          timestamp.toLocaleTimeString(),
          timestamp
        ], { prepare: true });
      } catch (dbError) {
        console.error('❌ Error saving broadcast to database:', dbError);
      }

      // Prepare broadcast payload
      const broadcastPayload = {
        messageId,
        groupId,
        teacherEmail: email,
        teacherName: socket.userName || email,
        text,
        timestamp: timestamp.toISOString(),
        subjectDisplay: `${groupInfo.subject || subject} - ${groupInfo.className || classOrYear}`,
        boardOrUniversity: boardOrUniversity || groupInfo.board || '',
        classOrYear: classOrYear || groupInfo.className || '',
        subject: subject || groupInfo.subject || ''
      };

      // Send to all subscribed students (via their user rooms)
      const io = getIO();
      students.forEach(student => {
        io.to(`user:${student.email}`).emit('new_broadcast', {
          ...broadcastPayload,
          studentEmail: student.email // Include for individual tracking
        });
      });
      
      // Also emit to the broadcast room for students currently viewing
      io.to(`broadcast:${groupId}`).emit('new_broadcast', broadcastPayload);

      // Confirm to teacher
      socket.emit('broadcast_sent', {
        ...broadcastPayload,
        recipientCount: students.length
      });

      console.log(`📢 Broadcast sent by ${email} to ${students.length} students in group ${groupId}`);
    } catch (error) {
      console.error('❌ Error sending broadcast:', error);
      socket.emit('broadcast_error', { error: 'Failed to send broadcast' });
    }
  });

  // Get student's broadcast subscriptions
  socket.on('get_student_broadcasts', async () => {
    try {
      if (role !== 'student') {
        socket.emit('broadcast_error', { error: 'Only students can access broadcast subscriptions' });
        return;
      }

      const broadcasts = await getStudentBroadcastSubscriptions(email);
      socket.emit('student_broadcasts', { broadcasts });
      console.log(`📢 Sent ${broadcasts.length} broadcast subscriptions to student ${email}`);
    } catch (error) {
      console.error('❌ Error getting student broadcasts:', error);
      socket.emit('broadcast_error', { error: 'Failed to get broadcast subscriptions' });
    }
  });

  // Join a broadcast group room for real-time updates
  socket.on('join_broadcast', async (data) => {
    try {
      const { groupId } = data;
      if (!groupId) {
        socket.emit('broadcast_error', { error: 'Group ID required' });
        return;
      }

      // Parse group info
      const groupInfo = parseGroupId(groupId);
      
      // Verify student is subscribed to this group
      const checkQuery = `
        SELECT * FROM booking_requests 
        WHERE student_email = ? AND teacher_email = ? AND subject = ? AND class_name = ? AND status = ?
        ALLOW FILTERING
      `;
      
      const checkResult = await client.execute(checkQuery, [
        email, groupInfo.teacherEmail, groupInfo.subject, groupInfo.className, 'subscribed'
      ], { prepare: true });
      
      if (!checkResult.rows || checkResult.rows.length === 0) {
        socket.emit('broadcast_error', { error: 'You are not subscribed to this broadcast group' });
        return;
      }

      // Join the broadcast room
      socket.join(`broadcast:${groupId}`);
      console.log(`📢 Student ${email} joined broadcast room: ${groupId}`);
      
      socket.emit('broadcast_joined', { groupId, success: true });
    } catch (error) {
      console.error('❌ Error joining broadcast:', error);
      socket.emit('broadcast_error', { error: 'Failed to join broadcast group' });
    }
  });

  // Leave a broadcast group room
  socket.on('leave_broadcast', (data) => {
    try {
      const { groupId } = data;
      if (groupId) {
        socket.leave(`broadcast:${groupId}`);
        console.log(`📢 Student ${email} left broadcast room: ${groupId}`);
      }
    } catch (error) {
      console.error('❌ Error leaving broadcast:', error);
    }
  });

  // Handle chat availability (when booking is accepted/subscribed)
  socket.on('chat_available_check', async (data) => {
    const { studentEmail, teacherEmail, subject, className } = data;
    
    try {
      // Check if booking exists with subscribed status
      const query = `
        SELECT * FROM booking_requests 
        WHERE student_email = ? AND teacher_email = ? AND status = ?
        ALLOW FILTERING
      `;
      const result = await client.execute(query, [studentEmail, teacherEmail, 'subscribed'], { prepare: true });
      
      if (result.rows && result.rows.length > 0) {
        const io = getIO();
        
        // Notify both parties that chat is available
        io.to(`user:${studentEmail}`).emit('chat_available', {
          contactEmail: teacherEmail,
          contactName: socket.userName || teacherEmail,
          subject,
          className
        });
        
        io.to(`user:${teacherEmail}`).emit('chat_available', {
          contactEmail: studentEmail,
          contactName: socket.userName || studentEmail,
          subject,
          className
        });

        // Also notify about new broadcast group if teacher
        if (role === 'teacher') {
          const groups = await getTeacherBroadcastGroups(teacherEmail);
          socket.emit('broadcast_groups', { groups });
        }
      }
    } catch (error) {
      console.error('❌ Error checking chat availability:', error);
    }
  });
}

// ============ HELPER FUNCTIONS ============

/**
 * Get chat history between two users with optional subject context
 */
async function getChatHistory(chatId, userEmail, contactEmail, subject = null, class_name = null, boardOrUniversity = null) {
  try {
    // Query the new messages table for individual chat messages
    // The chatId already includes subject context if provided
    const query = `
      SELECT id, sender_email, recipient_email, text, created_at, is_read, encrypted, public_key, message_hash, subject, class_name, board_or_university
      FROM messages 
      WHERE chat_id = ? 
      ORDER BY id ASC
      ALLOW FILTERING
    `;
    
    const result = await client.execute(query, [chatId], { prepare: true });
    
    if (!result.rows || result.rows.length === 0) {
      return [];
    }

    // Format messages for frontend
    return result.rows
      .map(row => ({
        id: row.id?.toString() || `msg_${Date.now()}`,
        text: row.text,
        sender: row.sender_email,
        recipient: row.recipient_email,
        timestamp: row.created_at?.getTime() || Date.now(),
        isRead: row.is_read || false,
        isMe: row.sender_email === userEmail,
        encrypted: row.encrypted || false,
        publicKey: row.public_key || null,
        messageHash: row.message_hash || null,
        subject: row.subject || null,
        className: row.class_name || null,
        boardOrUniversity: row.board_or_university || null
      }));
  } catch (error) {
    console.error('❌ Error fetching chat history:', error);
    return [];
  }
}

/**
 * Get teacher's broadcast groups based on subscribed students per subject
 */
async function getTeacherBroadcastGroups(teacherEmail) {
  try {
    // Query booking_requests table for subscribed students
    const query = `
      SELECT * FROM booking_requests 
      WHERE teacher_email = ? AND status = ?
      ALLOW FILTERING
    `;
    
    const result = await client.execute(query, [teacherEmail, 'subscribed'], { prepare: true });
    
    if (!result.rows || result.rows.length === 0) {
      return [];
    }

    // Group students by subject-class combination
    const groups = new Map();
    const profilePics = new Map();

    await Promise.all(result.rows.map(async (row) => {
      try {
        const userResult = await client.execute(
          'SELECT profileimage FROM users WHERE email = ? LIMIT 1',
          [row.student_email],
          { prepare: true }
        );
        const profilePic = userResult.rows?.[0]?.profileimage;
        if (profilePic) {
          profilePics.set(row.student_email, profilePic);
          return;
        }

        const studentResult = await client.execute(
          'SELECT profileimage FROM student WHERE email = ? LIMIT 1',
          [row.student_email],
          { prepare: true }
        );
        if (studentResult.rows?.[0]?.profileimage) {
          profilePics.set(row.student_email, studentResult.rows[0].profileimage);
        }
      } catch (error) {
        console.warn(`⚠️ Could not fetch current profile picture for ${row.student_email}:`, error.message);
      }
    }));
    
    for (const row of result.rows) {
      const subject = row.subject || 'General';
      const className = row.class_name || 'All Classes';
      const groupKey = `${subject}_${className}`;
      
      const studentInfo = row.student_info ? (typeof row.student_info === 'string' ? JSON.parse(row.student_info) : row.student_info) : {};
      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          groupId: `group_${teacherEmail}_${groupKey}`,
          teacherEmail,
          subject,
          className,
          boardOrUniversity: studentInfo.board || studentInfo.university || studentInfo.boardOrUniversity || '',
          students: [],
          studentCount: 0
        });
      }
      
      const group = groups.get(groupKey);
      const profilePic = profilePics.get(row.student_email) || null;
      group.students.push({
        email: row.student_email,
        name: row.student_name,
        profilePic,
        joinedAt: row.created_at
      });
      group.studentCount = group.students.length;
    }

    return Array.from(groups.values());
  } catch (error) {
    console.error('❌ Error getting broadcast groups:', error);
    return [];
  }
}

/**
 * Get subscribed students for a specific broadcast group
 */
async function getSubscribedStudentsForGroup(teacherEmail, groupInfo) {
  try {
    const query = `
      SELECT student_email, student_name, created_at 
      FROM booking_requests 
      WHERE teacher_email = ? AND status = ? AND subject = ? AND class_name = ?
      ALLOW FILTERING
    `;
    
    const result = await client.execute(query, [
      teacherEmail, 
      'subscribed', 
      groupInfo.subject, 
      groupInfo.className
    ], { prepare: true });
    
    if (!result.rows) return [];
    
    return result.rows.map(row => ({
      email: row.student_email,
      name: row.student_name,
      joinedAt: row.created_at
    }));
  } catch (error) {
    console.error('❌ Error getting subscribed students:', error);
    return [];
  }
}

/**
 * Get student's broadcast subscriptions
 */
async function getStudentBroadcastSubscriptions(studentEmail) {
  try {
    // Query booking_requests for student's subscribed teachers
    const query = `
      SELECT teacher_email, subject, class_name, student_info
      FROM booking_requests 
      WHERE student_email = ? AND status = ?
      ALLOW FILTERING
    `;
    
    const result = await client.execute(query, [studentEmail, 'subscribed'], { prepare: true });
    
    if (!result.rows) return [];
    
    // Get teacher details for each subscription
    const subscriptions = [];
    
    for (const row of result.rows) {
      // Get teacher name
      const teacherQuery = `
        SELECT name, profilepic FROM teachers1 
        WHERE email = ? 
        LIMIT 1
      `;
      const teacherResult = await client.execute(teacherQuery, [row.teacher_email], { prepare: true });
      
      const teacher = teacherResult.rows?.[0];
      
      const studentInfo = row.student_info ? (typeof row.student_info === 'string' ? JSON.parse(row.student_info) : row.student_info) : {};
      subscriptions.push({
        groupId: `group_${row.teacher_email}_${row.subject}_${row.class_name}`,
        teacherEmail: row.teacher_email,
        teacherName: teacher?.name || row.teacher_email,
        teacherProfilePic: teacher?.profilepic || null,
        subject: row.subject,
        className: row.class_name,
        boardOrUniversity: studentInfo.board || studentInfo.university || studentInfo.boardOrUniversity || ''
      });
    }
    
    return subscriptions;
  } catch (error) {
    console.error('❌ Error getting student broadcast subscriptions:', error);
    return [];
  }
}

/**
 * Parse group ID to extract subject and class info
 * Format: group_{teacherEmail}_{subject}_{className}
 * Note: subject and className may contain underscores (from spaces)
 */
function parseGroupId(groupId) {
  if (!groupId || !groupId.startsWith('group_')) {
    return { subject: '', className: '', board: '' };
  }
  
  // Remove 'group_' prefix
  const rest = groupId.substring(6);
  
  // Find teacher email (ends with .com, .org, etc. followed by underscore)
  const emailMatch = rest.match(/^(.+?@[^._]+\.[a-z]{2,})_(.+)$/);
  if (!emailMatch) {
    return { subject: '', className: '', board: '' };
  }
  
  const teacherEmail = emailMatch[1];
  const afterEmail = emailMatch[2];
  
  // Now split the remaining part by underscore
  // The format is: subject_className (both may contain underscores)
  // We need to find the split point - usually subject is first, className is rest
  const parts = afterEmail.split('_');
  
  if (parts.length >= 2) {
    // Assume first part is subject, rest is className
    const subject = parts[0];
    const className = parts.slice(1).join('_');
    return {
      teacherEmail,
      subject,
      className,
      board: ''
    };
  }
  
  return { teacherEmail, subject: '', className: '', board: '' };
}

/**
 * Handle booking status updates to update broadcast groups
 */
async function handleBookingStatusUpdate(bookingData) {
  try {
    const { bookingId, teacherEmail, studentEmail, status, subject, className } = bookingData;
    
    // Only process subscribed status
    if (status !== 'subscribed') return;
    
    const io = getIO();
    
    // Notify teacher to refresh broadcast groups
    io.to(`user:${teacherEmail}`).emit('student_joined_broadcast', {
      groupId: `group_${teacherEmail}_${subject}_${className}`,
      studentEmail,
      studentName: bookingData.studentName,
      boardOrUniversity: bookingData.boardOrUniversity || '',
      classOrYear: className,
      subject
    });
    
    // Refresh teacher's broadcast groups
    const groups = await getTeacherBroadcastGroups(teacherEmail);
    io.to(`user:${teacherEmail}`).emit('broadcast_groups', { groups });
    
    console.log(`🎉 Student ${studentEmail} joined broadcast group for ${subject} - ${className}`);
  } catch (error) {
    console.error('❌ Error handling booking status update:', error);
  }
}

module.exports = {
  initChatSocket,
  getTeacherBroadcastGroups,
  getStudentBroadcastSubscriptions,
  handleBookingStatusUpdate,
  getPerformanceMetrics,
  trackMessageDelivery
};
