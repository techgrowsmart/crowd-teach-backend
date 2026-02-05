const mongoose = require('mongoose');

const connectMongoDB = async () => {
  try {
    const mongoURI = process.env.MONGO_DB_URL;
    
    if (!mongoURI) {
      console.error('❌ MongoDB URI not found in environment variables');
      console.log('Available env vars:', Object.keys(process.env).filter(key => key.includes('MONGO')));
      return;
    }

    console.log('🔄 Connecting to MongoDB...');
    
    const options = {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    };

    const conn = await mongoose.connect(mongoURI, options);
    console.log('✅ Connected to MongoDB successfully');
    console.log('📊 Database:', conn.connection.name);
    
    // Handle connection events
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
    console.error('❌ MongoDB connection failed:', error);
    throw error;
  }
};

module.exports = connectMongoDB;
