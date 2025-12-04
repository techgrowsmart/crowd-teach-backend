const client = require("../config/db");
const redisClient = require("../config/redis");


// simple helper used everywhere in this file
async function ensureRedis() {
  try {
    // Prefer a wrapper method if present, otherwise fall back to connect()
    if (typeof redisClient.ensureConnected === 'function') {
      await redisClient.ensureConnected();
      return;
    }
    if (typeof redisClient.connect === 'function') {
      await redisClient.connect();
      return;
    }

    // Last-resort: mark as open so callers don't repeatedly try to connect
    redisClient.isOpen = true;
  } catch (err) {
    // Non-fatal: log and proceed. Many endpoints can operate without Redis.
    console.warn('⚠️ ensureRedis warning:', err && err.message ? err.message : err);
    redisClient.isOpen = true;
  }
}


const preloadTeachersToQueue = async () => {
    const query = `
    SELECT * FROM teachers1
  `;

    const result = await client.execute(query, [], { prepare: true });

    const teachersMap = [];
    const spotlightMap = [];
    const parsed = JSON.parse(JSON.stringify(result.rows));

    for (let teacher of parsed) {
        const tuitionParsed = JSON.parse(teacher.tuitions);
        for (let tuition of tuitionParsed) {
            const item = JSON.parse(JSON.stringify(teacher));
            item.class = tuition.class;
            item.subject = tuition.subject;
            item.board = tuition.board;
            item.timeFrom = tuition.timeFrom;
            item.timeTo = tuition.timeTo;
            item.charge = tuition.charge;
            item.day = tuition.day;
            item.classId = tuition.classId;
            delete item.tuitions;
            teachersMap.push(item);
        }
        if (teacher.isspotlight === true) {
            spotlightMap.push(teacher);
        }
    }

    await ensureRedis();

    const keysPopular = await redisClient.keys("teachersQueue:popular:*");
    if (keysPopular.length > 0) {
        await redisClient.del(...keysPopular);
    }
    for (const obj of teachersMap) {
        await redisClient.rPush("teachersQueue:popular:", JSON.stringify(obj)); // load new
    }

    const keysSpotlight = await redisClient.keys("teachersQueue:spotlight:*");
    if (keysSpotlight.length > 0) {
        await redisClient.del(...keysSpotlight);
    }
    for (const obj of spotlightMap) {
        await redisClient.rPush("teachersQueue:spotlight:", JSON.stringify(obj)); // load new
    }

    // DO NOT quit connection here — keep client open for app lifetime
    console.log("📦 Filtered teachers preloaded into Redis queues.");
};

module.exports = { preloadTeachersToQueue };
