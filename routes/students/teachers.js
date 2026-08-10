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

// Helpers to determine whether a teacher has subject or skill tuitions
function parseTuitions(t) {
  let tuitions = t.tuitions;
  if (typeof tuitions === 'string') {
    try { tuitions = JSON.parse(tuitions); } catch (err) { tuitions = []; }
  }
  return Array.isArray(tuitions) ? tuitions : [];
}
function hasSkill(t) { return parseTuitions(t).some(tu => tu.skill); }
function hasSubject(t) { return parseTuitions(t).some(tu => tu.subject || tu.class || tu.university); }

function getSpotlightCategories(t) {
    const type = t.spotlight_type ? String(t.spotlight_type).toLowerCase() : '';
    if (type === 'skill') return { isSkill: true, isSubject: false };
    if (type === 'subject') return { isSkill: false, isSubject: true };
    if (type === 'both') return { isSkill: true, isSubject: true };
    // Legacy rows: fall back to the tuitions they teach
    return { isSkill: hasSkill(t), isSubject: hasSubject(t) };
}

 router.post("/teachers", verifyToken, async (req, res) => {
    const count = parseInt(req.body.count) || 10;
    const searchQuery = req.body.search || "";
    const { board, className, subject, university, year, studentState } = req.body;

    const redisSpotlightKey = `teachersQueue:spotlight:`;
    const redisPopularKey = `teachersQueue:popular:`;
    
    try {
        await ensureRedis();

        const totalSpotlightCount = await redisClient.lLen(redisSpotlightKey);
        const totalPopularCount = await redisClient.lLen(redisPopularKey);
        const isEmpty = totalSpotlightCount === 0 && totalPopularCount === 0;

        // Load data from database if Redis is empty
        if (isEmpty) {
            await reloadRedisData();
            redisLastLoaded = Date.now();
        }

        // Check if Redis needs periodic reload
        const needsReload = await shouldReloadRedis(redisSpotlightKey, redisPopularKey);
        
        if (needsReload) {
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

        // ── Helper: filter by board/class/subject/university ──
        const filterTeachers = (teachers) => {
            if (university) {
                return teachers.filter(teacher => {
                    let tuitions = teacher.tuitions;
                    if (typeof tuitions === 'string') { try { tuitions = JSON.parse(tuitions); } catch { tuitions = []; } }
                    if (!Array.isArray(tuitions) || tuitions.length === 0) return false;
                    return tuitions.some(tu => {
                        const uMatch = !university || tu.university === university;
                        const yMatch = !year || tu.year === year;
                        const sMatch = !subject || tu.subject === subject;
                        return uMatch && yMatch && sMatch;
                    });
                });
            }
            if (!board && !className && !subject) return teachers;
            return teachers.filter(teacher => {
                let tuitions = teacher.tuitions;
                if (typeof tuitions === 'string') { try { tuitions = JSON.parse(tuitions); } catch { tuitions = []; } }
                if (!Array.isArray(tuitions) || tuitions.length === 0) return false;
                return tuitions.some(tu => {
                    const bMatch = !board || tu.board === board;
                    const cMatch = !className || tu.class === className;
                    const sMatch = !subject || tu.subject === subject;
                    return bMatch && cMatch && sMatch;
                });
            });
        };

        const processTeacher = (teacher) => {
            teacher.profilePic = teacher.profilepic || `https://ui-avatars.com/api/?name=${encodeURIComponent(teacher.name || 'User')}&background=random&size=200`;
            return teacher;
        };

        // ── POPULAR: ALL teachers from both Redis queues, no state filter (for My Tutors / My Skills) ──
        const allPopularRaw = await redisClient.lRange(redisPopularKey, 0, -1);
        const allSpotlightRaw = await redisClient.lRange(redisSpotlightKey, 0, -1);
        const allTeachers = [...allPopularRaw, ...allSpotlightRaw].map(item => JSON.parse(item));
        // Dedupe by email
        const seenEmails = new Set();
        const dedupedAll = allTeachers.filter(t => { if (seenEmails.has(t.email)) return false; seenEmails.add(t.email); return true; });
        const filteredPopular = filterTeachers(
            searchQuery.trim() ? dedupedAll.filter(t => t.name?.toLowerCase().includes(searchQuery.toLowerCase())) : dedupedAll
        ).map(processTeacher);

        // ── SPOTLIGHT: only teachers with active spotlight_states row for student's state ──
        let filteredSpotlight = [];
        if (studentState && studentState.trim()) {
            try {
                const now = new Date();
                const stateResult = await client.execute(
                    `SELECT teacher_email, spotlight_type, expiry FROM spotlight_states WHERE state = ? ALLOW FILTERING`,
                    [studentState.trim()], { prepare: true }
                );
                const validEmails = new Map(); // email → spotlight_type
                for (const row of stateResult.rows) {
                    if (row.expiry && new Date(row.expiry) > now) {
                        validEmails.set(row.teacher_email, row.spotlight_type);
                    }
                }

                // Match against full teacher pool (popular+spotlight Redis queues)
                const spotlightPool = dedupedAll.filter(t => validEmails.has(t.email));
                for (const t of spotlightPool) {
                    t.spotlight_type = validEmails.get(t.email) || t.spotlight_type;
                    t.isspotlight = true;
                }
                // Any email not found in Redis → fetch from DB
                const foundEmails = new Set(spotlightPool.map(t => t.email));
                const missingEmails = [...validEmails.keys()].filter(e => !foundEmails.has(e));
                let dbTeachers = [];
                if (missingEmails.length > 0) {
                    for (const teacherEmail of missingEmails) {
                        const dbResult = await client.execute(
                            `SELECT email, name, category, introduction, isspotlight, profilepic, qualifications, teachingmode, tuitions, workexperience, spotlight_type FROM teachers1 WHERE email = ? ALLOW FILTERING`,
                            [teacherEmail], { prepare: true }
                        );
                        for (const row of dbResult.rows) {
                            dbTeachers.push({ email: row.email, name: row.name, category: row.category, introduction: row.introduction, isspotlight: true, profilepic: row.profilepic, qualifications: row.qualifications, teachingmode: row.teachingmode, tuitions: row.tuitions, workexperience: row.workexperience, spotlight_type: validEmails.get(row.email) || row.spotlight_type });
                        }
                    }
                }
                const allSpotlightCandidates = [...spotlightPool, ...dbTeachers];
                const searched = searchQuery.trim() ? allSpotlightCandidates.filter(t => t.name?.toLowerCase().includes(searchQuery.toLowerCase())) : allSpotlightCandidates;
                filteredSpotlight = filterTeachers(searched).map(processTeacher);
            } catch (stateErr) {
                console.error('⚠️ spotlight_states query failed:', stateErr.message);
                // Fallback: show all spotlight teachers from Redis
                const fallback = allSpotlightRaw.map(item => JSON.parse(item));
                filteredSpotlight = filterTeachers(
                    searchQuery.trim() ? fallback.filter(t => t.name?.toLowerCase().includes(searchQuery.toLowerCase())) : fallback
                ).map(processTeacher);
            }
        } else {
            // No studentState → show all spotlight teachers from Redis
            const allSp = allSpotlightRaw.map(item => JSON.parse(item));
            filteredSpotlight = filterTeachers(
                searchQuery.trim() ? allSp.filter(t => t.name?.toLowerCase().includes(searchQuery.toLowerCase())) : allSp
            ).map(processTeacher);
        }

        const spotlightSkill = filteredSpotlight.filter(t => getSpotlightCategories(t).isSkill);
        const spotlightSubject = filteredSpotlight.filter(t => getSpotlightCategories(t).isSubject);

        const spotlightByCategory = {
            ...(spotlightSkill.length && { "Skill teacher": spotlightSkill }),
            ...(spotlightSubject.length && { "Subject teacher": spotlightSubject }),
        };

        const groupPopular = {};
        for (const t of filteredPopular) {
            if (hasSkill(t)) {
                if (!groupPopular["Skill teacher"]) groupPopular["Skill teacher"] = [];
                groupPopular["Skill teacher"].push(t);
            }
            if (hasSubject(t)) {
                if (!groupPopular["Subject teacher"]) groupPopular["Subject teacher"] = [];
                groupPopular["Subject teacher"].push(t);
            }
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
        if (res.headersSent) return;
        return await fetchTeachersFromDatabase(req, res, board, className, subject, university, year, searchQuery, studentState);
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
        
        return isEmpty || needsTimeBasedReload;
    } catch (error) {
        console.error("Error checking Redis status:", error);
        return true; // Reload if we can't check status
    }
}

async function reloadRedisData() {
    try {
        await ensureRedis();

        // Clear existing Redis data
        await redisClient.del('teachersQueue:spotlight:');
        await redisClient.del('teachersQueue:popular:');
        
        // 🚨 FIX: Use only existing columns from teachers1 table
        const query = `
            SELECT email, name, category, introduction, isspotlight, profilepic, 
                   qualifications, teachingmode, tuitions, workexperience, spotlight_type
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
                spotlight_type: teacher.spotlight_type,
            };

            const serialized = JSON.stringify(formattedTeacher);
            
            if (teacher.isspotlight === true) {
                await redisClient.rPush('teachersQueue:spotlight:', serialized);
            } else {
                await redisClient.rPush('teachersQueue:popular:', serialized);
            }
            loadedCount++;
        }

        // Set expiration to prevent stale data (24 hours)
        await redisClient.expire('teachersQueue:spotlight:', 86400);
        await redisClient.expire('teachersQueue:popular:', 86400);

        return loadedCount;
    } catch (error) {
        console.error("Error reloading Redis data:", error);
        throw error;
    }
}

// Keep the manual clear endpoint for emergencies
router.get("/clear-and-reload-redis", async (req, res) => {
    try {
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

    if (!status || !['active', 'dormant', 'banned', 'rejected', 'resubmit'].includes(status)) {
      return res.status(400).json({ 
        success: false, 
        message: "❌ Valid status is required (active, dormant, banned, rejected, resubmit)",
        code: "INVALID_STATUS"
      });
    }

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

// Fallback function to fetch teachers directly from database when Redis fails
async function fetchTeachersFromDatabase(req, res, board, className, subject, university, year, searchQuery, studentState) {
    try {
        const query = `
            SELECT email, name, category, introduction, isspotlight, profilepic, 
                   qualifications, teachingmode, tuitions, workexperience, spotlight_type
            FROM teachers1
        `;
        
        const result = await client.execute(query, [], { prepare: true });
        
        // Build state-valid spotlight set if studentState provided
        let spotlightStateEmails = null; // null = no filter
        let emailToStateType = {};
        if (studentState && studentState.trim()) {
            try {
                const now = new Date();
                const stateResult = await client.execute(
                    `SELECT teacher_email, spotlight_type, expiry FROM spotlight_states WHERE state = ? ALLOW FILTERING`,
                    [studentState.trim()], { prepare: true }
                );
                spotlightStateEmails = new Set();
                for (const row of stateResult.rows) {
                    if (row.expiry && new Date(row.expiry) > now) {
                        spotlightStateEmails.add(row.teacher_email);
                        emailToStateType[row.teacher_email] = row.spotlight_type;
                    }
                }
            } catch (e) {
                console.error('⚠️ spotlight_states fallback query failed:', e.message);
            }
        }

        const teachers = [];
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
                spotlight_type: teacher.spotlight_type,
            };
            teachers.push(formattedTeacher);
        }
        
        // Apply filtering
        const filterTeachers = (teachers) => {
            // University flow
            if (university) {
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
                            const universityMatch = !university || (tuition.university && tuition.university === university);
                            const yearMatch = !year || (tuition.year && tuition.year === year);
                            const subjectMatch = !subject || (tuition.subject && tuition.subject === subject);
                            
                            return universityMatch && yearMatch && subjectMatch;
                        });
                        
                        return hasMatch;
                    }
                    return false;
                });
            }
            
            // Board flow (original)
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
            const protocol = req.headers.host?.includes('localhost') ? 'http' : 'https';
            teacher.profilePic =
                teacher.profilepic || `https://ui-avatars.com/api/?name=${encodeURIComponent(teacher.name || 'User')}&background=random&size=200`;
            return teacher;
        };

        const allFiltered = filterTeachers(teachers).map(processTeacher);

        // Split into spotlight (state-filtered) and popular
        const spotlightTeachers = allFiltered.filter(t => {
            if (!t.isspotlight) return false;
            if (spotlightStateEmails === null) return true; // no state filter
            if (!spotlightStateEmails.has(t.email)) return false;
            // Override spotlight_type from state-specific purchase
            t.spotlight_type = emailToStateType[t.email] || t.spotlight_type;
            return true;
        });

        const spotlightEmailSet = new Set(spotlightTeachers.map(t => t.email));
        const popularTeachers = allFiltered.filter(t => !spotlightEmailSet.has(t.email));
        
        const spotlightSkill = spotlightTeachers.filter(t => getSpotlightCategories(t).isSkill);
        const spotlightSubject = spotlightTeachers.filter(t => getSpotlightCategories(t).isSubject);

        const spotlightByCategory = {
            ...(spotlightSkill.length && { "Skill teacher": spotlightSkill }),
            ...(spotlightSubject.length && { "Subject teacher": spotlightSubject }),
        };

        const groupPopular = {};
        for (const t of popularTeachers) {
            if (hasSkill(t)) {
                if (!groupPopular["Skill teacher"]) groupPopular["Skill teacher"] = [];
                groupPopular["Skill teacher"].push(t);
            }
            if (hasSubject(t)) {
                if (!groupPopular["Subject teacher"]) groupPopular["Subject teacher"] = [];
                groupPopular["Subject teacher"].push(t);
            }
        }

        return res.json({
            spotlightTeachers: spotlightByCategory,
            popularTeachers: groupPopular,
            totalSkillCount: spotlightSkill.length,
            totalSubjectCount: allFiltered.length,
        });
    } catch (error) {
        console.error("❌ Error fetching teachers from database:", error);
        return res.status(500).json({
            spotlightTeachers: {},
            popularTeachers: {},
            totalSkillCount: 0,
            totalSubjectCount: 0,
            message: "Failed to fetch teachers from database",
            error: error.message
        });
    }
}

module.exports = router;
