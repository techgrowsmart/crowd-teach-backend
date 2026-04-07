const mongoose = require('mongoose');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const connectWithRetry = async (uri, options, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await mongoose.connect(uri, options);
    } catch (err) {
      if (i === retries - 1) throw err;
      console.log(`🔄 MongoDB retry ${i + 1}/${retries} in 2s...`);
      await sleep(2000);
    }
  }
};

const connectMongoDB = async () => {
  if (process.env.SKIP_MONGO === 'true') {
    console.log('⚠️ SKIP_MONGO=true: MongoDB connection skipped (server will run with limited features)');
    return null;
  }

  let mongoURI = process.env.MONGO_DB_URL;

  // Use local MongoDB when running in Docker
  if (process.env.USE_LOCAL_DB === 'true' && process.env.LOCAL_MONGO_URL) {
    mongoURI = process.env.LOCAL_MONGO_URL;
    console.log('🐳 Using local MongoDB (Docker)');
  }

  if (!mongoURI) {
    console.error('❌ MongoDB URI not found in environment variables');
    console.log('Available env vars:', Object.keys(process.env).filter(key => key.includes('MONGO')));
    throw new Error('MONGO_DB_URL is required');
  }

  // DEBUG: Log raw env variable
  console.log('🔍 RAW MONGO_DB_DATABASE env:', process.env.MONGO_DB_DATABASE);

  // Use production database for posts (GrowThoughts)
  const dbName = process.env.MONGO_DB_DATABASE || 'gogrowsmart';

  console.log('🔍 Final dbName used:', dbName);

  // Ensure database name is in the URI (required for Atlas connections)
  // MongoDB Atlas URIs have format: mongodb+srv://user:pass@host.mongodb.net/dbname?options
  if (mongoURI.includes('mongodb.net')) {
    // Check if URI already has a database name (anything between .net/ and ?)
    const dbNameMatch = mongoURI.match(/\.mongodb\.net\/([^?]+)\?/);
    if (dbNameMatch) {
      // Replace existing database name with the correct one
      const existingDbName = dbNameMatch[1];
      if (existingDbName !== dbName) {
        mongoURI = mongoURI.replace(`/${existingDbName}?`, `/${dbName}?`);
        console.log(`🔄 Replaced database '${existingDbName}' with '${dbName}'`);
      }
    } else if (mongoURI.includes('/?')) {
      // Replace /? with /dbname?
      mongoURI = mongoURI.replace('/?', `/${dbName}?`);
    } else if (mongoURI.endsWith('/')) {
      // Append dbname if ends with /
      mongoURI = `${mongoURI}${dbName}`;
    } else if (!mongoURI.match(/\/[^/]+\?/)) {
      // No database name in URI, add it before query params
      mongoURI = mongoURI.replace('?', `/${dbName}?`);
    }
  }

  const options = {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
  };

  console.log('📂 MongoDB database:', dbName);
  console.log('� MongoDB URI pattern:', mongoURI.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')); // Hide credentials

  const urisToTry = [mongoURI];

  // No fallback - only use the configured database
  for (const uri of urisToTry) {
    try {
      console.log(`🔄 Connecting to MongoDB...`);

      const conn = await connectWithRetry(uri, options);
      console.log('✅ Connected to MongoDB successfully');
      console.log('📊 Database:', conn.connection.name);

      mongoose.connection.on('error', (err) => {
        console.error('❌ MongoDB connection error:', err);
      });

      mongoose.connection.on('disconnected', () => {
        console.log('⚠️ MongoDB disconnected');
      });

      mongoose.connection.on('reconnected', () => {
        console.log('🔄 MongoDB reconnected');
      });

      return conn;
    } catch (error) {
      console.error('❌ MongoDB connection failed:', error.message);
      if (error.message?.includes('whitelist') || error.message?.includes('Could not connect')) {
        console.log('\n📌 Fix: Add your IP to MongoDB Atlas Network Access:');
        console.log('   https://cloud.mongodb.com → Network Access → Add IP Address\n');
      }
      throw error;
    }
  }
};

module.exports = connectMongoDB;
