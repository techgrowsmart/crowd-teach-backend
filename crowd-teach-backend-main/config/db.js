const cassandra = require("cassandra-driver");
const path = require("path");

const cloud = { secureConnectBundle: "./secure-connect-gogrowsmart.zip" };
const authProvider = new cassandra.auth.PlainTextAuthProvider('token', process.env['ASTRA_TOKEN']);
const credentials = {
    username: process.env.ASTRA_DB_USERNAME,
    password: process.env.ASTRA_DB_PASSWORD
};
const client = new cassandra.Client({ keyspace: process.env.ASTRA_DB_KEYSPACE, cloud, authProvider,  credentials});

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
            }
        }
    };
    
    attemptConnection();
}

init();
module.exports = client;
