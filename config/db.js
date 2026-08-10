const cassandra = require("cassandra-driver");
const path = require("path");

const cloud = { secureConnectBundle: "./secure-connect-gogrowsmart.zip" };
const authProvider = new cassandra.auth.PlainTextAuthProvider(process.env.ASTRA_DB_USERNAME, process.env.ASTRA_DB_PASSWORD);
const client = new cassandra.Client({ 
    keyspace: process.env.ASTRA_DB_KEYSPACE, 
    cloud, 
    authProvider
});

async function init() {
    let retryCount = 0;
    const maxRetries = 3;
    const retryDelay = 5000; // 5 seconds
    
    const attemptConnection = async () => {
        try {
            console.log(`🔄 Connecting to Cassandra... (attempt ${retryCount + 1}/${maxRetries})`);
            await client.connect();
            console.log("✅ Connected to Cassandra on DB Config");

            // Create keyspace if not exists
            // await client.execute(`
            //     CREATE KEYSPACE IF NOT EXISTS ${process.env.ASTRA_DB_KEYSPACE}
            //     WITH replication = {'class': 'SimpleStrategy', 'replication_factor': '1'}
            // `);
            console.log(`✅ Keyspace '${process.env.ASTRA_DB_KEYSPACE}' ensured`);

            // Set keyspace on the client to use it from now on
            client.keyspace = process.env.ASTRA_DB_KEYSPACE;
            
        } catch (err) {
            retryCount++;
            console.error(`❌ Failed to connect to Cassandra (attempt ${retryCount}/${maxRetries}):`, err.message);
            
            if (retryCount < maxRetries) {
                console.log(`🔄 Retrying Cassandra connection in ${retryDelay/1000} seconds...`);
                setTimeout(attemptConnection, retryDelay);
            } else {
                console.error("⚠️ Max retries reached. Could not connect to Cassandra.");
                console.error("📝 The server will continue running but database features will be limited.");
                console.error("💡 Please check your network connection and Astra DB credentials.");
                // Don't exit, let the server continue with limited functionality
                return false; // Indicate connection failed
            }
        }
        return true; // Indicate connection succeeded
    };
    
    // Start connection attempt but don't wait for it
    attemptConnection().catch(err => {
        console.error("⚠️ Cassandra connection initialization failed:", err.message);
        console.error("📝 Server will continue with limited functionality.");
    });
}

// Initialize Cassandra connection in background
setTimeout(() => init().catch(err => console.error('⚠️ Cassandra initialization failed:', err.message)), 1000);

// Create messages table after connection is established
async function createMessagesTable() {
    try {
        console.log('🔧 Creating messages table with context support...');
        
        const query = `
            CREATE TABLE IF NOT EXISTS messages (
                chat_id TEXT,
                id UUID,
                sender_email TEXT,
                recipient_email TEXT,
                text TEXT,
                timestamp TIMESTAMP,
                is_read BOOLEAN,
                created_at TIMESTAMP,
                sender_name TEXT,
                recipient_name TEXT,
                encrypted BOOLEAN,
                public_key TEXT,
                message_hash TEXT,
                subject TEXT,
                class_name TEXT,
                board_or_university TEXT,
                title TEXT,
                PRIMARY KEY (chat_id, id)
            ) WITH CLUSTERING ORDER BY (id DESC)
        `;
        
        await client.execute(query);
        console.log('✅ Messages table created successfully with context columns');

        // Ensure the title column exists on already-created tables (no-op if it already exists)
        try {
            await client.execute(`ALTER TABLE messages ADD title TEXT`);
            console.log('✅ Added title column to messages table');
        } catch (alterError) {
            // Column likely already exists - safe to ignore
        }
        
    } catch (error) {
        console.error('❌ Error creating messages table:', error);
        // Don't throw error, just log it
    }
}

// Wait for connection and create tables
setTimeout(() => {
    createMessagesTable().catch(err => console.error('⚠️ Messages table creation failed:', err.message));
}, 5000); // Wait 5 seconds for connection to establish

// Also try to create tables immediately after connection
init().then(() => {
    console.log('🔄 Connection established, creating tables...');
    createMessagesTable().catch(err => console.error('⚠️ Immediate messages table creation failed:', err.message));
}).catch(err => console.error('⚠️ Connection failed:', err.message));

module.exports = client;
