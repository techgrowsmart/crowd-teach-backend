const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

let io = null;
const connectedUsers = new Map(); // email -> socket.id

function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: [
        // Local development
        'http://localhost:8081', 'http://localhost:3000', 'http://localhost:19006',
        'http://localhost:8080', 'http://127.0.0.1:8081', 'http://127.0.0.1:3000',
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
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
    allowEIO3: true,
    // Production optimizations
    perMessageDeflate: {
      threshold: 1024 // Compress messages > 1KB
    },
    maxHttpBufferSize: 1e6 // 1MB max message size
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
    socket.on('booking_response', (data) => {
      const { bookingId, studentEmail, status, message } = data;
      
      console.log(`✅ Teacher ${email} ${status} booking ${bookingId}`);
      
      // Validate teacher is responding to their own request
      // In production, verify the booking belongs to this teacher
      
      const response = {
        bookingId: bookingId,
        teacherEmail: email,
        teacherName: socket.userName,
        status: status, // 'accepted', 'rejected'
        message: message || `Teacher has ${status} your request`,
        timestamp: new Date().toISOString()
      };

      // Notify student immediately
      io.to(`user:${studentEmail}`).emit('booking_status_update', response);
      
      // Confirm to teacher
      socket.emit('booking_response_confirmed', {
        success: true,
        bookingId: bookingId,
        status: status
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

module.exports = {
  initSocket,
  getIO,
  getConnectedUsers,
  isUserOnline,
  notifyUser,
  broadcastToTeachers,
  broadcastToStudents
};
