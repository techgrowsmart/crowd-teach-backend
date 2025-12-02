const cassandra = require('cassandra-driver');

const client = new cassandra.Client({ 
  keyspace: process.env.ASTRA_DB_KEYSPACE, 
  cloud: { secureConnectBundle: "./secure-connect-gogrowsmart.zip" },
  authProvider: new cassandra.auth.PlainTextAuthProvider('token', process.env['ASTRA_TOKEN']),
  credentials: {
    username: process.env.ASTRA_DB_USERNAME,
    password: process.env.ASTRA_DB_PASSWORD
  }
});

// Helper function to ensure table exists
const ensureReadStatusTable = async () => {
  try {
    const tableExists = await client.execute(
      "SELECT table_name FROM system_schema.tables WHERE keyspace_name = ? AND table_name = ?",
      [process.env.ASTRA_DB_KEYSPACE, 'notification_read_status'],
      { prepare: true }
    );

    if (tableExists.rowLength === 0) {
      console.log('🔄 Creating notification_read_status table...');
      await client.execute(`
        CREATE TABLE notification_read_status (
          user_id text,
          notification_id uuid,
          is_read boolean,
          read_at timestamp,
          PRIMARY KEY ((user_id, notification_id))
        ) WITH additional_write_policy = '99p'
        AND bloom_filter_fp_chance = 0.01
        AND caching = {'keys': 'ALL', 'rows_per_partition': 'NONE'}
        AND comment = ''
        AND compaction = {'class': 'org.apache.cassandra.db.compaction.UnifiedCompactionStrategy'}
        AND compression = {'chunk_length_in_kb': '16', 'class': 'org.apache.cassandra.io.compress.LZ4Compressor'}
        AND crc_check_chance = 1.0
        AND default_time_to_live = 0
        AND gc_grace_seconds = 864000
        AND max_index_interval = 2048
        AND memtable_flush_period_in_ms = 0
        AND min_index_interval = 128
        AND read_repair = 'BLOCKING'
        AND speculative_retry = '99p';
      `);
      console.log('✅ Created notification_read_status table');
    } else {
      console.log('✅ notification_read_status table exists');
    }
    return true;
  } catch (error) {
    console.error('❌ Error ensuring notification_read_status table:', error);
    return false;
  }
};

// Get notifications based on user role with read status
exports.getNotifications = async (req, res) => {
    try {
        console.log('🔔 Starting to fetch notifications...');
        
        // Get user email from token to fetch their role
        const userEmail = req.user.email;
        console.log(`👤 User email: ${userEmail}`);
        
        // First, get user's role from database
        const userQuery = "SELECT role FROM users WHERE email = ? ALLOW FILTERING";
        const userResult = await client.execute(userQuery, [userEmail], { prepare: true });
        
        if (userResult.rowLength === 0) {
            console.log('❌ User not found in database');
            return res.status(404).json({ error: 'User not found' });
        }
        
        const userRole = userResult.rows[0].role;
        console.log(`📥 Fetching notifications for ${userRole}...`);
        
        // Get notifications for user's role AND notifications for 'all'
        const query1 = 'SELECT id, sender_name, avatar_url, message, created_at, target_role FROM notifications WHERE target_role = ?';
        const query2 = 'SELECT id, sender_name, avatar_url, message, created_at, target_role FROM notifications WHERE target_role = ?';
        
        // Execute both queries in parallel
        const [roleResult, allResult] = await Promise.all([
            client.execute(query1, [userRole], { prepare: true }),
            client.execute(query2, ['all'], { prepare: true })
        ]);
        
        // Combine results
        const allNotifications = [...roleResult.rows, ...allResult.rows];
        console.log(`📊 Raw notifications found: ${allNotifications.length}`);
        
        // Ensure read status table exists before querying
        await ensureReadStatusTable();
        
        // Get read status for all notifications for this user
        let readNotificationIds = new Set();
        try {
            // Using ALLOW FILTERING since we're querying on a non-partition key
            const readStatusQuery = 'SELECT notification_id FROM notification_read_status WHERE user_id = ? ALLOW FILTERING';
            console.log(`🔍 Checking read status for user: ${userEmail}`);
            const readStatusResult = await client.execute(readStatusQuery, [userEmail], { prepare: true });
            
            if (readStatusResult && readStatusResult.rows) {
                readNotificationIds = new Set(
                    readStatusResult.rows.map(row => row.notification_id.toString())
                );
                console.log(`📖 Found ${readStatusResult.rowLength} read notifications for ${userEmail}`);
                console.log('📝 Read notification IDs:', Array.from(readNotificationIds));
            }
        } catch (readError) {
            console.error('❌ Error fetching read status:', readError.message);
            console.error('Stack:', readError.stack);
        }
        
        console.log(`✅ Found ${allNotifications.length} notifications for ${userRole}, ${readNotificationIds.size} read`);
        
        // Format the notifications with read status
        const notifications = allNotifications.map(notification => ({
            id: notification.id.toString(),
            sender_name: notification.sender_name || 'System',
            avatar_url: notification.avatar_url || 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png',
            message: notification.message,
            created_at: notification.created_at || new Date(),
            target_role: notification.target_role,
            is_read: readNotificationIds.has(notification.id.toString())
        }));

        // Sort by creation date (newest first)
        notifications.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        
        console.log(`🎯 Sending ${notifications.length} formatted notifications`);
        res.json(notifications);
    } catch (error) {
        console.error('❌ Error in getNotifications:', error);
        res.status(500).json({ 
            error: 'Failed to fetch notifications',
            details: error.message
        });
    }
};

// Get count of unread notifications
exports.getUnreadCount = async (req, res) => {
    try {
        const userEmail = req.user.email;
        console.log(`🔢 Getting unread count for user: ${userEmail}`);
        
        // Get user's role first
        const userQuery = "SELECT role FROM users WHERE email = ? ALLOW FILTERING";
        const userResult = await client.execute(userQuery, [userEmail], { prepare: true });
        
        if (userResult.rowLength === 0) {
            console.log('❌ User not found');
            return res.json({ count: 0 });
        }
        
        const userRole = userResult.rows[0].role;
        console.log(`👤 User role: ${userRole}`);
        
        // Get total notifications for this user's role AND 'all'
        const notificationsQuery = `
            SELECT id FROM notifications 
            WHERE target_role IN (?, ?)
        `;
        const notificationsResult = await client.execute(
            notificationsQuery, 
            [userRole, 'all'], 
            { prepare: true }
        );
        
        const totalNotifications = notificationsResult.rows.length;
        console.log(`📝 Total notifications for ${userRole}: ${totalNotifications}`);
        
        // Get read notifications for this user
        const readStatusQuery = `SELECT notification_id FROM notification_read_status WHERE user_id = ? ALLOW FILTERING`;
        const readStatusResult = await client.execute(readStatusQuery, [userEmail], { prepare: true });
        
        const readCount = readStatusResult.rowLength;
        console.log(`📖 User has read ${readCount} notifications`);
        
        // Calculate unread count: total - read
        const unreadCount = totalNotifications - readCount;
        
        // Ensure unread count is not negative
        const finalUnreadCount = Math.max(0, unreadCount);
        
        console.log(`📊 Final unread count: ${finalUnreadCount} (${totalNotifications} total - ${readCount} read)`);
        res.json({ count: finalUnreadCount });
        
    } catch (error) {
        console.error('❌ Error getting unread count:', error);
        // Return 0 as fallback to prevent frontend errors
        res.json({ count: 0 });
    }
};

// Mark notification as read
exports.markAsRead = async (req, res) => {
    try {
        const userEmail = req.user.email;
        const { notification_id } = req.body;
        
        console.log(`📝 Marking notification as read: ${notification_id} for user: ${userEmail}`);
        
        if (!notification_id) {
            return res.status(400).json({ 
                message: 'Notification ID is required'
            });
        }

        // Ensure table exists before inserting
        const tableExists = await ensureReadStatusTable();
        if (!tableExists) {
            return res.status(500).json({ 
                error: 'Database table not available'
            });
        }

        const query = `
            INSERT INTO notification_read_status (user_id, notification_id, is_read, read_at)
            VALUES (?, ?, true, toTimestamp(now()))
            IF NOT EXISTS
        `;
        
        try {
            await client.execute(
                query, 
                [userEmail, cassandra.types.Uuid.fromString(notification_id)],
                { prepare: true }
            );
            console.log(`✅ Successfully marked notification ${notification_id} as read for user ${userEmail}`);
        } catch (error) {
            console.error('❌ Error executing mark as read query:', error);
            throw error; // Let the error be caught by the outer try-catch
        }
        
        res.status(200).json({ 
            message: 'Notification marked as read successfully'
        });
    } catch (error) {
        console.error('❌ Error marking notification as read:', error);
        res.status(500).json({ 
            error: 'Failed to mark notification as read',
            details: error.message,
            code: error.code
        });
    }
};

// Add a new notification with role targeting
exports.addNotification = async (req, res) => {
    try {
        const { sender_name, message, avatar_url, target_role } = req.body;
        
        if (!sender_name || !message || !target_role) {
            return res.status(400).json({ 
                message: 'Sender name, message, and target role are required',
                valid_roles: ['student', 'teacher', 'all']
            });
        }

        // Validate target_role
        const validRoles = ['student', 'teacher', 'all'];
        if (!validRoles.includes(target_role)) {
            return res.status(400).json({ 
                message: 'Invalid target role',
                valid_roles: validRoles
            });
        }

        const query = `
            INSERT INTO notifications (id, sender_name, avatar_url, message, created_at, target_role)
            VALUES (uuid(), ?, ?, ?, toTimestamp(now()), ?)
        `;
        
        await client.execute(
            query, 
            [
                sender_name,
                avatar_url || 'https://cdn-icons-png.flaticon.com/512/3135/3135715.png',
                message,
                target_role
            ],
            { prepare: true }
        );
        
        console.log(`✅ Notification added successfully for ${target_role}`);
        res.status(201).json({ 
            message: 'Notification added successfully',
            target_role: target_role
        });
    } catch (error) {
        console.error('❌ Error adding notification:', error);
        res.status(500).json({ 
            error: 'Failed to add notification',
            details: error.message 
        });
    }
};