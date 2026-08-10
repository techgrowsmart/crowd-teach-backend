const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { initChatSocket, handleBookingStatusUpdate } = require('./services/socket-chat');

let io = null;
const connectedUsers = new Map(); // email -> socket.id
const subjectGroups = new Map(); // "teacherEmail:subject:className" -> Set of student emails
const teacherSubjects = new Map(); // teacherEmail -> Set of subjects they teach

function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: [
        // Local development
        'http://localhost:8081', 'http://localhost:3000', 'http://localhost:19006',
        'http://localhost:8080', 'http://127.0.0.1:8081', 'http://127.0.0.1:3000',
        // Local network IP for Expo dev server
        'http://192.168.29.35:8081', 'http://192.168.29.35:19006',
        // Allow any local network IP (dynamic across machines)
        /^http:\/\/192\.168\.\d+\.\d+:\d+$/, /^http:\/\/10\.\d+\.\d+:\d+$/,
        // Production domains
        'https://portal.gogrowsmart.com',
        'https://gogrowsmart.com',
        'https://www.gogrowsmart.com',
        'https://growsmartserver.gogrowsmart.com',
        // Allow all gogrowsmart subdomains
        /\.gogrowsmart\.com$/
      ],
      methods: ['GET', 'POST'],
      credentials: true
    },
    // OPTIMIZATION: Configure for maximum speed
    transports: ['websocket'], // WebSocket only for fastest delivery
    pingTimeout: 60000,
    pingInterval: 25000,
    allowEIO3: true,
    // Production optimizations for speed
    perMessageDeflate: false, // Disable compression for faster delivery
    maxHttpBufferSize: 1e6, // 1MB max message size
    // OPTIMIZATION: Engine.IO settings for nano-second delivery
    upgradeTimeout: 1000, // Faster upgrade to WebSocket
    rememberUpgrade: true, // Remember successful upgrades
    // Additional speed optimizations
    compression: false, // No compression for maximum speed
    forceJSONP: false // Don't force JSONP
  });

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.query.token;
      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET_KEY);
      socket.userEmail = decoded.email;
      socket.userRole = decoded.role;
      socket.userName = decoded.name;
      
      next();
    } catch (error) {
      console.error('Socket authentication error:', error.message);
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const email = socket.userEmail;
    const role = socket.userRole;
    
    console.log(`🔌 User connected: ${email} (${role}) - Socket ID: ${socket.id}`);
    
    // Store connection
    connectedUsers.set(email, {
      socketId: socket.id,
      role: role,
      name: socket.userName,
      connectedAt: new Date()
    });

    // Join role-based room
    socket.join(role); // 'student' or 'teacher'
    
    // Join personal room for direct messages
    socket.join(`user:${email}`);

    // Initialize chat and broadcast socket handlers
    initChatSocket(socket, email, role);

    // Handle booking request from student
    socket.on('booking_request', (data) => {
      const { teacherEmail, subject, className, charge, studentInfo } = data;
      
      console.log(`📨 Booking request from ${email} to ${teacherEmail}`);
      
      // Create booking request object
      const bookingRequest = {
        id: `booking_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        studentEmail: email,
        studentName: socket.userName,
        teacherEmail: teacherEmail,
        subject: subject,
        className: className,
        charge: charge,
        status: 'pending',
        timestamp: new Date().toISOString(),
        studentInfo: studentInfo || {}
      };

      // Notify teacher in real-time
      io.to(`user:${teacherEmail}`).emit('new_booking_request', bookingRequest);
      
      // Also notify all teachers (for backup)
      io.to('teacher').emit('new_booking_request_broadcast', {
        ...bookingRequest,
        targetTeacher: teacherEmail
      });

      // Confirm to student
      socket.emit('booking_request_sent', {
        success: true,
        bookingId: bookingRequest.id,
        message: 'Request sent to teacher'
      });
    });

    // Handle teacher's response to booking
    socket.on('booking_response', async (data) => {
      const { bookingId, studentEmail, status, message, subject, className, studentName, boardOrUniversity } = data;
      
      console.log(`✅ Teacher ${email} ${status} booking ${bookingId}`);
      
      // Validate teacher is responding to their own request
      // In production, verify the booking belongs to this teacher
      
      const response = {
        bookingId: bookingId,
        teacherEmail: email,
        teacherName: socket.userName,
        status: status, // 'accepted', 'rejected', 'subscribed'
        message: message || `Teacher has ${status} your request`,
        timestamp: new Date().toISOString(),
        subject,
        className
      };

      // Notify student via HTTP route (PUT /api/bookings/respond) which is the
      // single source of truth for emitting booking_status_update. The HTTP route
      // only emits when the status actually transitions, preventing duplicate alerts.

      // If status is accepted or subscribed, make chat available and update broadcast groups
      if (status === 'accepted' || status === 'subscribed') {
        // Trigger chat availability for the student immediately on accept
        io.to(`user:${studentEmail}`).emit('chat_available', {
          contactEmail: email,
          contactName: socket.userName || email,
          subject,
          className
        });
      }

      if (status === 'subscribed') {
        console.log(`🎉 Booking ${bookingId} marked as subscribed - updating broadcast groups`);
        
        // Notify teacher about new student in broadcast group
        io.to(`user:${email}`).emit('student_joined_broadcast', {
          groupId: `group_${email}_${subject}_${className}`,
          studentEmail,
          studentName: studentName || studentEmail,
          boardOrUniversity: boardOrUniversity || '',
          classOrYear: className,
          subject
        });
        
        // Refresh teacher's broadcast groups
        const { getTeacherBroadcastGroups } = require('./services/socket-chat');
        const groups = await getTeacherBroadcastGroups(email);
        io.to(`user:${email}`).emit('broadcast_groups', { groups });
      }
      
      // Confirm to teacher
      socket.emit('booking_response_confirmed', {
        success: true,
        bookingId: bookingId,
        status: status
      });
    });

    // Handle teacher broadcasting to subject groups
    socket.on('broadcast_to_subject', (data) => {
      const { subject, className, message, broadcastType = 'subject' } = data;
      
      if (role !== 'teacher') {
        socket.emit('broadcast_error', { error: 'Only teachers can broadcast' });
        return;
      }

      const groupKey = `${email}:${subject}:${className}`;
      const subscribedStudents = subjectGroups.get(groupKey) || new Set();
      
      console.log(`📢 Teacher ${email} broadcasting to ${subject}:${className} - ${subscribedStudents.size} students`);

      const broadcastData = {
        id: `broadcast_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        teacherEmail: email,
        teacherName: socket.userName,
        subject: subject,
        className: className,
        message: message,
        type: broadcastType,
        timestamp: new Date().toISOString(),
        studentCount: subscribedStudents.size
      };

      // Broadcast to all subscribed students in this subject group
      subscribedStudents.forEach(studentEmail => {
        io.to(`user:${studentEmail}`).emit('new_broadcast', broadcastData);
      });

      // Confirm to teacher
      socket.emit('broadcast_sent', {
        success: true,
        broadcastId: broadcastData.id,
        studentCount: subscribedStudents.size,
        message: `Message sent to ${subscribedStudents.size} students`
      });
    });

    // Handle student joining subject groups (when subscription is confirmed)
    socket.on('join_subject_group', (data) => {
      const { teacherEmail, subject, className } = data;
      
      if (role !== 'student') {
        socket.emit('group_join_error', { error: 'Only students can join subject groups' });
        return;
      }

      const groupKey = `${teacherEmail}:${subject}:${className}`;
      
      if (!subjectGroups.has(groupKey)) {
        subjectGroups.set(groupKey, new Set());
      }
      
      subjectGroups.get(groupKey).add(email);
      
      // Join socket room for this subject group
      socket.join(`subject:${groupKey}`);
      
      console.log(`👥 Student ${email} joined subject group: ${groupKey}`);
      
      socket.emit('group_joined', {
        success: true,
        groupKey: groupKey,
        studentCount: subjectGroups.get(groupKey).size
      });

      // Notify teacher about new student (optional)
      io.to(`user:${teacherEmail}`).emit('student_joined_subject', {
        studentEmail: email,
        studentName: socket.userName,
        subject: subject,
        className: className,
        totalStudents: subjectGroups.get(groupKey).size
      });
    });

    // Handle student leaving subject groups
    socket.on('leave_subject_group', (data) => {
      const { teacherEmail, subject, className } = data;
      
      if (role !== 'student') {
        socket.emit('group_leave_error', { error: 'Only students can leave subject groups' });
        return;
      }

      const groupKey = `${teacherEmail}:${subject}:${className}`;
      
      if (subjectGroups.has(groupKey)) {
        subjectGroups.get(groupKey).delete(email);
        
        // Remove from socket room
        socket.leave(`subject:${groupKey}`);
        
        // Clean up empty groups
        if (subjectGroups.get(groupKey).size === 0) {
          subjectGroups.delete(groupKey);
        }
        
        console.log(`👋 Student ${email} left subject group: ${groupKey}`);
        
        socket.emit('group_left', {
          success: true,
          groupKey: groupKey
        });
      }
    });

    // Handle teacher getting their subject groups
    socket.on('get_my_subject_groups', () => {
      if (role !== 'teacher') {
        socket.emit('groups_error', { error: 'Only teachers can view their subject groups' });
        return;
      }

      const teacherGroups = [];
      
      subjectGroups.forEach((students, groupKey) => {
        if (groupKey.startsWith(`${email}:`)) {
          const [_, subject, className] = groupKey.split(':');
          teacherGroups.push({
            groupKey: groupKey,
            subject: subject,
            className: className,
            studentCount: students.size,
            students: Array.from(students)
          });
        }
      });

      socket.emit('my_subject_groups', {
        success: true,
        groups: teacherGroups
      });
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      console.log(`❌ User disconnected: ${email} - Reason: ${reason}`);
      connectedUsers.delete(email);
    });

    // Error handling
    socket.on('error', (error) => {
      console.error(`Socket error for ${email}:`, error);
    });
  });

  return io;
}

// Helper functions for external use
function getIO() {
  if (!io) {
    throw new Error('Socket.io not initialized');
  }
  return io;
}

function getConnectedUsers() {
  return Array.from(connectedUsers.entries()).map(([email, data]) => ({
    email,
    ...data
  }));
}

function isUserOnline(email) {
  return connectedUsers.has(email);
}

function notifyUser(email, event, data) {
  if (io) {
    io.to(`user:${email}`).emit(event, data);
  }
}

function broadcastToTeachers(event, data) {
  if (io) {
    io.to('teacher').emit(event, data);
  }
}

function broadcastToStudents(event, data) {
  if (io) {
    io.to('student').emit(event, data);
  }
}

// Broadcast helper functions for subject groups
function addToSubjectGroup(teacherEmail, subject, className, studentEmail) {
  const groupKey = `${teacherEmail}:${subject}:${className}`;
  if (!subjectGroups.has(groupKey)) {
    subjectGroups.set(groupKey, new Set());
  }
  subjectGroups.get(groupKey).add(studentEmail);
  console.log(`➕ Added ${studentEmail} to subject group: ${groupKey}`);
}

function removeFromSubjectGroup(teacherEmail, subject, className, studentEmail) {
  const groupKey = `${teacherEmail}:${subject}:${className}`;
  if (subjectGroups.has(groupKey)) {
    subjectGroups.get(groupKey).delete(studentEmail);
    if (subjectGroups.get(groupKey).size === 0) {
      subjectGroups.delete(groupKey);
    }
    console.log(`➖ Removed ${studentEmail} from subject group: ${groupKey}`);
  }
}

function getSubjectGroupMembers(teacherEmail, subject, className) {
  const groupKey = `${teacherEmail}:${subject}:${className}`;
  return Array.from(subjectGroups.get(groupKey) || []);
}

function getTeacherSubjectGroups(teacherEmail) {
  const groups = [];
  subjectGroups.forEach((students, groupKey) => {
    if (groupKey.startsWith(`${teacherEmail}:`)) {
      const [_, subject, className] = groupKey.split(':');
      groups.push({
        groupKey: groupKey,
        subject: subject,
        className: className,
        studentCount: students.size,
        students: Array.from(students)
      });
    }
  });
  return groups;
}

function broadcastToSubjectGroup(teacherEmail, subject, className, event, data) {
  const groupKey = `${teacherEmail}:${subject}:${className}`;
  const students = subjectGroups.get(groupKey) || new Set();
  
  students.forEach(studentEmail => {
    notifyUser(studentEmail, event, data);
  });
  
  console.log(`📢 Broadcast to ${groupKey}: ${students.size} students`);
  return students.size;
}

module.exports = {
  initSocket,
  getIO,
  getConnectedUsers,
  connectedUsers,
  isUserOnline,
  notifyUser,
  broadcastToTeachers,
  broadcastToStudents,
  // New broadcast functions
  addToSubjectGroup,
  removeFromSubjectGroup,
  getSubjectGroupMembers,
  getTeacherSubjectGroups,
  broadcastToSubjectGroup
};
