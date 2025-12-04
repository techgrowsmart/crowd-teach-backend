const express = require("express");
const router = express.Router();
const { db } = require("../../config/firebase");
const verifyToken = require("../../utils/verifyToken");
const redisClient = require("../../config/redis");
const client = require("../../config/db");

// Track when Redis was last loaded
let redisLastLoaded = null;
const REDIS_RELOAD_INTERVAL = 5 * 60 * 1000; // 5 minutes

// simple helper used everywhere in this file
async function ensureRedis() {
  try {
    // ensure redis client is ready (safe no-op if already connected)
    if (typeof redisClient.ensureConnected === 'function') {
      await redisClient.ensureConnected();
    } else if (typeof redisClient.connect === 'function') {
      // backward compatibility if wrapper didn't expose ensureConnected()
      await redisClient.connect();
    } else {
      // no-op: mark open so callers don't repeatedly fail
      redisClient.isOpen = true;
    }
  } catch (err) {
    console.warn('⚠️ ensureRedis warning (teachers.js):', err && err.message ? err.message : err);
    // keep going (some endpoints can operate without Redis)
    redisClient.isOpen = true;
  }
}

async function ensureRedis() {
  try {
// ensure redis client is ready (safe no-op if already connected)
await redisClient.ensureConnected();

}

router.post("/teachers", verifyToken, async (req, res) => {
    const count = parseInt(req.body.count) || 10;
    const searchQuery = req.body.search || "";
    const { board, className, subject } = req.body;

    const redisSpotlightKey = `teachersQueue:spotlight:`;
    const redisPopularKey = `teachersQueue:popular:`;
    
    try {
        await ensureRedis();

        const totalSpotlightCount = await redisClient.lLen(redisSpotlightKey);
        const totalPopularCount = await redisClient.lLen(redisPopularKey);
        const isEmpty = totalSpotlightCount === 0 && totalPopularCount === 0;

        // 🚨 FIX: Handle empty Redis by loading data first instead of redirecting
        if (isEmpty) {
            console.log(`[Redis] Queues empty. Loading teachers from database...`);
            await reloadRedisData();
            redisLastLoaded = Date.now();
        }

        // Then check if Redis needs reloading
        const needsReload = await shouldReloadRedis(redisSpotlightKey, redisPopularKey);
        
        if (needsReload) {
            console.log(`🔄 Auto-reloading Redis...`);
            await reloadRedisData();
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

        // If still no teachers after reload, return empty results instead of error
        if (spotlightRotated.length === 0 && popularRotated.length === 0) {
            console.log("📭 No teachers found in system after reload");
            return res.json({
                spotlightTeachers: {},
                popularTeachers: {},
                totalSkillCount: 0,
                totalSubjectCount: 0,
                message: "No teachers available at the moment"
            });
        }

        // Apply board/class/subject filtering if provide
        const filterTeachers = (teachers) => {
            if (!board && !className && !subject) {
                return teachers;
            }

            console.log(`🔍 Filtering teachers with:`, { board, className, subject });
            
            return teachers.filter(teacher => {
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
                teacher.profilepic || `http://${req.headers.host}/uploads/default-profile.png`;
            return teacher;
        };

        // Apply filtering to both spotlight and popular teachers
        const filteredSpotlight = filterTeachers(spotlightRotated).map(processTeacher);
        const filteredPopular = filterTeachers(popularRotated).map(processTeacher);

        console.log(`📊 Filtering Results:`, {
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
        console.error("Redis/DB fetch error:", error);
        
        // 🚨 FIX: Return empty results instead of 500 error when no teachers
        return res.status(200).json({
            spotlightTeachers: {},
            popularTeachers: {},
            totalSkillCount: 0,
            totalSubjectCount: 0,
            message: "No teachers available at the moment",
            error: error.message
        });
    }
});

// 🎯 AUTOMATION FUNCTIONS

async function shouldReloadRedis(spotlightKey, popularKey) {
    try {
        // Check if Redis queues are empty
        const spotlightCount = await redisClient.lLen(spotlightKey);
        const popularCount = await redisClient.lLen(popularKey);
        const isEmpty = spotlightCount === 0 && popularCount === 0;
        
        // Check if it's been a while since last reload
        const timeSinceLastLoad = redisLastLoaded ? Date.now() - redisLastLoaded : Infinity;
        const needsTimeBasedReload = timeSinceLastLoad > REDIS_RELOAD_INTERVAL;
        
        console.log(`🕒 Redis Status:`, {
            spotlightCount,
            popularCount, 
            isEmpty,
            timeSinceLastLoad: `${Math.round(timeSinceLastLoad / 1000)}s`,
            needsTimeBasedReload
        });
        
        return isEmpty || needsTimeBasedReload;
    } catch (error) {
        console.error("Error checking Redis status:", error);
        return true; // Reload if we can't check status
    }
}

async function reloadRedisData() {
    try {
        console.log(`🔄 Loading teachers from TEACHERS1 table...`);
        await ensureRedis();

        // Clear existing Redis data
        await redisClient.del('teachersQueue:spotlight:');
        await redisClient.del('teachersQueue:popular:');
        
        // 🚨 FIX: Use only existing columns from teachers1 table
        const query = `
            SELECT email, name, category, introduction, isspotlight, profilepic, 
                   qualifications, teachingmode, tuitions, workexperience
            FROM teachers1
        `;
        
        const result = await client.execute(query, [], { prepare: true });

        let loadedCount = 0;
        for (const teacher of result.rows) {
            const formattedTeacher = {
                email: teacher.email,
                name: teacher.name,
                category: teacher.category,
                introduction: teacher.introduction,
                isspotlight: teacher.isspotlight,
                profilepic: teacher.profilepic,
                qualifications: teacher.qualifications,
                teachingmode: teacher.teachingmode,
                tuitions: teacher.tuitions,
                workexperience: teacher.workexperience,
            };

            const serialized = JSON.stringify(formattedTeacher);
            
            if (teacher.isspotlight === true) {
                await redisClient.rPush('teachersQueue:spotlight:', serialized);
            } else {
                await redisClient.rPush('teachersQueue:popular:', serialized);
            }
            loadedCount++;
        }

        console.log(`✅ Loaded ${loadedCount} teachers from TEACHERS1 table into Redis`);
        return loadedCount;
    } catch (error) {
        console.error("Error reloading Redis data:", error);
        throw error;
    }
}

// Keep the manual clear endpoint for emergencies
router.get("/clear-and-reload-redis", async (req, res) => {
    try {
        console.log("🔄 Manual Redis reload requested...");
        const count = await reloadRedisData();
        redisLastLoaded = Date.now();
        
        res.json({ 
            success: true, 
            message: `Redis reloaded with ${count} teachers`,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error("Error in manual Redis reload:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/teacherSubjects', verifyToken, async (req, res) => {
    try {
        const { email, name } = req.body;

        if (!email || !name) {
            return res.status(400).json({ success: false, message: "Email and name are required" });
        }

        const query = `SELECT tuitions FROM teachers1 WHERE email = ? AND name = ? LIMIT 1`;
        const result = await client.execute(query, [email, name], { prepare: true });

        if (result.rows.length === 0) {
            return res.status(200).json({
                success: true,
                subjectCount: 0,
            });
        }

        const tuitions = result.rows[0].tuitions;

        let tuitionArray = tuitions;

        if (typeof tuitions === "string") {
            try {
                tuitionArray = JSON.parse(tuitions);
            } catch (err) {
                console.error("Failed to parse tuitions:", err);
                return res.status(500).json({ success: false, message: "Invalid tuitions format" });
            }
        }

        return res.status(200).json({
            success: true,
            subjectCount: tuitionArray.length,
        });

    } catch (error) {
        console.error("Error fetching teacher subjects:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
});


// 🎯 UPDATE TEACHER STATUS (active, dormant, banned) - SIMPLE GET VERSION
router.get("/update-teacher-status", async (req, res) => {
  try {
    const { teacherEmail, status } = req.query; // Changed from req.body to req.query

    // Input validation
    if (!teacherEmail || !teacherEmail.includes('@')) {
      return res.status(400).json({ 
        success: false, 
        message: "❌ Valid teacher email is required",
        code: "INVALID_EMAIL"
      });
    }

    if (!status || !['active', 'dormant', 'banned'].includes(status)) {
      return res.status(400).json({ 
        success: false, 
        message: "❌ Valid status is required (active, dormant, banned)",
        code: "INVALID_STATUS"
      });
    }

    console.log(`🔄 Status update request for teacher: ${teacherEmail} -> ${status}`);

    // Check if teacher exists and get current status
    const checkQuery = `
      SELECT id, email, role, status, name 
      FROM users 
      WHERE email = ? 
      ALLOW FILTERING
    `;
    
    const teacherResult = await client.execute(checkQuery, [teacherEmail.trim().toLowerCase()], { 
      prepare: true 
    });

    if (teacherResult.rowLength === 0) {
      return res.status(404).json({ 
        success: false, 
        message: "❌ Teacher not found in system",
        code: "TEACHER_NOT_FOUND"
      });
    }

    const teacher = teacherResult.rows[0];
    
    // Business logic validation
    if (teacher.role !== 'teacher') {
      return res.status(400).json({ 
        success: false, 
        message: "❌ User is not registered as a teacher",
        code: "NOT_A_TEACHER",
        currentRole: teacher.role
      });
    }

    // Check if already in the requested status
    if (teacher.status === status) {
      return res.status(200).json({ 
        success: true, 
        message: `ℹ️ Teacher is already ${status}`,
        code: "ALREADY_IN_STATUS",
        data: {
          email: teacher.email,
          name: teacher.name,
          status: teacher.status
        }
      });
    }

    // Update teacher status with proper error handling
    const updateQuery = `
      UPDATE users 
      SET status = ? 
      WHERE id = ?
    `;
    
    await client.execute(updateQuery, [status, teacher.id], { 
      prepare: true 
    });

    // Log the status change for audit purposes
    console.log(`✅ TEACHER STATUS UPDATED: ${teacher.email} (${teacher.name}) - ${teacher.status} -> ${status}`);

    // Success response
    return res.status(200).json({
      success: true,
      message: `✅ Teacher status updated to ${status} successfully`,
      code: "STATUS_UPDATED",
      data: {
        email: teacher.email,
        name: teacher.name,
        previousStatus: teacher.status,
        newStatus: status,
        updatedAt: new Date().toISOString(),
        teacherId: teacher.id
      }
    });

  } catch (error) {
    console.error("❌ CRITICAL: Error updating teacher status:", {
      email: req.query.teacherEmail, // Changed from req.body to req.query
      status: req.query.status, // Changed from req.body to req.query
      error: error.message,
      timestamp: new Date().toISOString()
    });

    return res.status(500).json({ 
      success: false, 
      message: "❌ Internal server error while updating teacher status",
      code: "INTERNAL_SERVER_ERROR",
      referenceId: `ERR_${Date.now()}`
    });
  }
});

module.exports = router;
