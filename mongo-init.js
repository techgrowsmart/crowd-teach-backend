// MongoDB initialization script
db = db.getSiblingDB('gogrowsmart');

// Create collections and indexes
db.createCollection('users');
db.createCollection('sessions');
db.createCollection('analytics');
db.createCollection('logs');

// Create indexes for better performance
db.users.createIndex({ "email": 1 }, { unique: true });
db.users.createIndex({ "role": 1 });
db.users.createIndex({ "status": 1 });
db.users.createIndex({ "createdAt": 1 });

db.sessions.createIndex({ "userId": 1 });
db.sessions.createIndex({ "sessionToken": 1 }, { unique: true });
db.sessions.createIndex({ "expiresAt": 1 });

db.analytics.createIndex({ "userId": 1 });
db.analytics.createIndex({ "eventType": 1 });
db.analytics.createIndex({ "timestamp": 1 });

db.logs.createIndex({ "timestamp": 1 });
db.logs.createIndex({ "level": 1 });
db.logs.createIndex({ "userId": 1 });

// Create application user with limited permissions
db.createUser({
  user: "gogrowsmart_app",
  pwd: "app_password_123",
  roles: [
    {
      role: "readWrite",
      db: "gogrowsmart"
    }
  ]
});

print('MongoDB initialization completed successfully');
