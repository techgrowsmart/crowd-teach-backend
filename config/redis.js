const { createClient } = require("redis");

// const redisClient = createClient({
//     url: process.env.REDIS_URL
// });
const redisClient = createClient();

redisClient.on('success', () => {
    console.log("✅ Redis client connect successfully");
})
redisClient.on("error", (err) => {
    console.error("❌ Redis Client Error", err);
});

(async () => {
    await redisClient.connect();
    await redisClient.quit()
})();

module.exports = redisClient;
