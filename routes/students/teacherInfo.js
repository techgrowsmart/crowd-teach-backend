const express = require("express");
const router = express.Router();
const verifyToken = require("../../utils/verifyToken");
const redisClient = require("../../config/redis");
const client = require("../../config/db");

// Track when Redis was last loaded
let redisLastLoaded = null;
const REDIS_RELOAD_INTERVAL = 5 * 60 * 1000; // 5 minutes

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


router.post("/teacherInfo", verifyToken, async (req, res) => {
    const count = parseInt(req.body.count) || 10;
    const searchQuery = req.body.search || "";
    const { board, className, subject } = req.body;

    const redisSpotlightKey = `teachersQueue:spotlight:teacherInfo`;
    const redisPopularKey = `teachersQueue:popular:teacherInfo`;
    
    try {
        await ensureRedis();

        const totalSpotlightCount = await redisClient.lLen(redisSpotlightKey);
        const totalPopularCount = await redisClient.lLen(redisPopularKey);
        const isEmpty = totalSpotlightCount === 0 && totalPopularCount === 0;

        if (isEmpty) {
            console.log(`[Redis TeacherInfo] Queues empty. Loading from DB...`);
            await reloadTeacherInfoData();
        }

        // Check if Redis needs reloading
        const needsReload = await shouldReloadRedis(redisSpotlightKey, redisPopularKey);
        
        if (needsReload) {
            console.log(`🔄 Auto-reloading TeacherInfo Redis...`);
            await reloadTeacherInfoData();
            redisLastLoaded = Date.now();
        }

        async function rotateAndFetch(redisKey, count) {
            const teachers = [];
            for (let i = 0; i < count; i++) {
                const item = await redisClient.lPop(redisKey);
                if (!item) break;
                
                const teacher = JSON.parse(item);
                
                // Apply search filter on Redis data
                if (searchQuery.trim() === "" || 
                    teacher.name.toLowerCase().includes(searchQuery.toLowerCase())) {
                    teachers.push(teacher);
                }
                
                await redisClient.rPush(redisKey, item);
            }
            return teachers;
        }

        const spotlightRotated = await rotateAndFetch(redisSpotlightKey, count);
        const popularRotated = await rotateAndFetch(redisPopularKey, count);

        // Apply board/class/subject filtering if provided
        const filterTeachers = (teachers) => {
            if (!board && !className && !subject) {
                return teachers; // No filters applied - return all
            }

            console.log(`🔍 Filtering teachers with:`, { board, className, subject });
            
            return teachers.filter(teacher => {
                // Parse tuitions to check for matches
                let tuitions = teacher.tuitions;
                if (typeof tuitions === 'string') {
                    try {
                        tuitions = JSON.parse(tuitions);
                    } catch (err) {
                        console.error("Failed to parse tuitions:", err);
                        tuitions = [];
                    }
                }

                if (Array.isArray(tuitions) && tuitions.length > 0) {
                    // Check if any tuition matches the search criteria
                    const hasMatch = tuitions.some(tuition => {
                        const boardMatch = !board || (tuition.board && tuition.board === board);
                        const classMatch = !className || (tuition.class && tuition.class === className);
                        const subjectMatch = !subject || (tuition.subject && tuition.subject === subject);
                        
                        return boardMatch && classMatch && subjectMatch;
                    });
                    
                    return hasMatch;
                }
                return false;
            });
        };

        const processTeacher = (teacher) => {
            teacher.profilePic =
                teacher.profilepic || `https://${req.headers.host}/uploads/default-profile.png`;
            return teacher;
        };

        // Apply filtering to both spotlight and popular teachers
        const filteredSpotlight = filterTeachers(spotlightRotated).map(processTeacher);
        const filteredPopular = filterTeachers(popularRotated).map(processTeacher);

        console.log(`📊 TeacherInfo Filtering Results:`, {
            board,
            className, 
            subject,
            spotlightBefore: spotlightRotated.length,
            popularBefore: popularRotated.length,
            spotlightAfter: filteredSpotlight.length,
            popularAfter: filteredPopular.length
        });

        const spotlightSkill = filteredSpotlight
            .filter((t) => t.category === "Skill teacher");

        const spotlightSubject = filteredSpotlight
            .filter((t) => t.category === "Subject teacher");

        const spotlightByCategory = {
            ...(spotlightSkill.length && { "Skill teacher": spotlightSkill }),
            ...(spotlightSubject.length && { "Subject teacher": spotlightSubject }),
        };

        const groupPopular = {};
        for (const t of filteredPopular) {
            const cat = t.category || "Uncategorized";
            if (!groupPopular[cat]) groupPopular[cat] = [];
            groupPopular[cat].push(t);
        }

        const totalSpotlightLength = await redisClient.lLen(redisSpotlightKey);
        
        return res.json({
            spotlightTeachers: spotlightByCategory,
            popularTeachers: groupPopular,
            totalSkillCount: spotlightSkill.length,
            totalSubjectCount: totalSpotlightLength,
        });
    } catch (error) {
        console.error("TeacherInfo Redis/DB fetch error:", error);
        return res.status(500).json({
            error: "Failed to fetch teachers from teacher_info",
        });
    }
});

// Redis automation functions for teacher_info
async function shouldReloadRedis(spotlightKey, popularKey) {
    try {
        const spotlightCount = await redisClient.lLen(spotlightKey);
        const popularCount = await redisClient.lLen(popularKey);
        const isEmpty = spotlightCount === 0 && popularCount === 0;
        
        const timeSinceLastLoad = redisLastLoaded ? Date.now() - redisLastLoaded : Infinity;
        const needsTimeBasedReload = timeSinceLastLoad > REDIS_RELOAD_INTERVAL;
        
        return isEmpty || needsTimeBasedReload;
    } catch (error) {
        console.error("Error checking TeacherInfo Redis status:", error);
        return true;
    }
}

async function reloadTeacherInfoData() {
    try {
        console.log(`🔄 Loading teachers from TEACHER_INFO table...`);
        await ensureRedis();

        // Clear existing Redis data
        await redisClient.del('teachersQueue:spotlight:teacherInfo');
        await redisClient.del('teachersQueue:popular:teacherInfo');
        
        // Load from TEACHER_INFO table
        const query = `
            SELECT id, email, name, tutions, profilepic, introduction 
            FROM teacher_info
        `;
        
        const result = await client.execute(query, [], { prepare: true });

        let loadedCount = 0;
        for (const teacher of result.rows) {
            const formattedTeacher = {
                email: teacher.email,
                name: teacher.name,
                profilepic: teacher.profilepic,
                profilePic: teacher.profilepic,
                introduction: teacher.introduction,
                category: "Subject teacher",
                isspotlight: true,
                qualifications: "[]",
                teachingmode: "[]",
                tuitions: teacher.tutions,
                workexperience: "",
                language: "English"
            };

            const serialized = JSON.stringify(formattedTeacher);
            await redisClient.rPush('teachersQueue:spotlight:teacherInfo', serialized);
            loadedCount++;
        }

        console.log(`✅ Loaded ${loadedCount} teachers from TEACHER_INFO table into Redis`);
        redisLastLoaded = Date.now();
        return loadedCount;
    } catch (error) {
        console.error("Error reloading TeacherInfo Redis data:", error);
        throw error;
    }
}

// Auto-reload on server start
setTimeout(async () => {
    try {
        console.log("🚀 Auto-reloading TeacherInfo Redis on server start...");
        await ensureRedis();
        await reloadTeacherInfoData();
        console.log("✅ TeacherInfo Redis auto-reload completed on server start");
    } catch (error) {
        console.error("❌ Failed to auto-reload TeacherInfo Redis on server start:", error);
    }
}, 5000);

module.exports = router;




