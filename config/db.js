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
    try {
        await client.connect().then(() => {console.log("✅ Connected to Cassandra on DB Config");}).catch((err) => {console.log(err);});

        // Create keyspace if not exists
        // await client.execute(`
        //     CREATE KEYSPACE IF NOT EXISTS ${process.env.ASTRA_DB_KEYSPACE}
        //     WITH replication = {'class': 'SimpleStrategy', 'replication_factor': '1'}
        // `);
        console.log(`✅ Keyspace '${process.env.ASTRA_DB_KEYSPACE}' ensured`);

        // Set keyspace on the client to use it from now on
        client.keyspace = process.env.ASTRA_DB_KEYSPACE;

    } catch (err) {
        console.error("❌ Failed to connect or create keyspace:", err);
        process.exit(1);
    }
}

init();
module.exports = client;
