
const admin = require("firebase-admin");

let db = null;

try {
  let serviceAccount;

  try {
    serviceAccount = require("./serviceAccountKey.json");
  } catch (error) {
    console.warn('⚠️ serviceAccountKey.json not found, using environment variables for Firebase');
    // Use environment variables as fallback
    serviceAccount = {
      "type": process.env.FIREBASE_TYPE || "service_account",
      "project_id": process.env.FIREBASE_PROJECT_ID,
      "private_key_id": process.env.FIREBASE_PRIVATE_KEY_ID,
      "private_key": process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      "client_email": process.env.FIREBASE_CLIENT_EMAIL,
      "client_id": process.env.FIREBASE_CLIENT_ID,
      "auth_uri": "https://accounts.google.com/o/oauth2/auth",
      "token_uri": "https://oauth2.googleapis.com/token"
    };
  }

  if (!serviceAccount.project_id || !serviceAccount.private_key || !serviceAccount.client_email) {
    console.warn('⚠️ Firebase Admin SDK credentials not properly configured.');
    console.warn('   To fix this:');
    console.warn('   1. Go to Firebase Console → Project Settings → Service Accounts');
    console.warn('   2. Click "Generate New Private Key"');
    console.warn('   3. Either:');
    console.warn('      a) Save the JSON file as config/serviceAccountKey.json, OR');
    console.warn('      b) Add the values to your .env file as FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL, etc.');
    console.warn('   Firebase features (chat, notifications, broadcasts) will be disabled until configured.');
    throw new Error('Missing Firebase credentials');
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    ignoreUndefinedProperties: true,
  });

  db = admin.firestore();
  console.log('✅ Firebase initialized successfully');
} catch (error) {
  console.warn('⚠️ Firebase initialization failed:', error.message);
  console.warn('⚠️ Firebase features will be disabled');
  
  // Create a mock db object to prevent crashes - supports full chaining
  const createMockDoc = () => ({
    get: async () => ({ exists: false, data: () => null }),
    set: async () => {},
    update: async () => {},
    delete: async () => {},
    collection: () => createMockCollection()
  });
  
  const createMockCollection = () => ({
    doc: () => createMockDoc(),
    add: async () => ({ id: 'mock-id' }),
    where: () => createMockCollection(),
    orderBy: () => createMockCollection(),
    get: async () => ({ docs: [], forEach: () => {} })
  });
  
  db = {
    collection: createMockCollection
  };
}

module.exports = { admin, db };
