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

  const mongoURI = process.env.MONGO_DB_URL;

  if (!mongoURI) {
    console.error('❌ MongoDB URI not found in environment variables');
    console.log('Available env vars:', Object.keys(process.env).filter(key => key.includes('MONGO')));
    throw new Error('MONGO_DB_URL is required');
  }

  // Use production database for posts (GrowThoughts). Default 'test' is used when db name is missing from URI.
  const dbName = process.env.MONGO_DB_DATABASE || 'gogrowsmart';

  const options = {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 10000,
    socketTimeoutMS: 45000,
    dbName: dbName,
  };

  console.log('📂 MongoDB database:', dbName);

  const urisToTry = [mongoURI];

  // In development, still try local fallback if Atlas fails
  // Comment this out to force production database only
  if (mongoURI.includes('mongodb.net') && process.env.NODE_ENV !== 'production' && process.env.FORCE_PRODUCTION_DB !== 'true') {
    urisToTry.push('mongodb://localhost:27017/gogrowsmart');
  }

  for (const uri of urisToTry) {
    try {
      const isLocal = uri.includes('localhost');
      console.log(`🔄 Connecting to MongoDB${isLocal ? ' (local fallback)' : ''}...`);

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
      if (uri.includes('localhost')) {
        console.error('❌ Local MongoDB also failed:', error.message);
      } else {
        console.error('❌ MongoDB connection failed:', error.message);
        if (error.message?.includes('whitelist') || error.message?.includes('Could not connect')) {
          console.log('\n📌 Fix: Add your IP to MongoDB Atlas Network Access:');
          console.log('   https://cloud.mongodb.com → Network Access → Add IP Address');
          console.log('   Or run local MongoDB: docker run -d -p 27017:27017 mongo\n');
        }
      }
      if (uri === urisToTry[urisToTry.length - 1]) throw error;
    }
  }
};

module.exports = connectMongoDB;
