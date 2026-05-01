const express = require("express");
const router = express.Router();
const client = require("../../config/db");
const fs = require("fs");
const path = require("path");
const verifyToken = require("../../utils/verifyToken");
const extractTuitions = (rows) => {
    const flatTuitions = [];
    for (const row of rows) {
        const tuitions = JSON.parse(row.tutions || "[]");

        for (const t of tuitions) {

            if (t.board && t.class && t.subject) {
                flatTuitions.push({
                    email: row.email,
                    name:row.name,
                    profilePic: row.profilepic || "",
                    board: t.board,
                    className: t.class,
                    classId: t.classId,
                    subject: t.subject,
                    charge: t.charge || "",
                    day: t.day || "",
                    timeFrom: t.timeFrom || "",
                    timeTo: t.timeTo || "",
                    description: row.introduction || "",
                    language: row.language || "English",
                });
            }

            if (t.university && t.year && t.subject) {
                flatTuitions.push({
                    email: row.email,
                    name:row.name,
                    profilePic: row.profilepic || "",
                    university: t.university,
                    universityId: t.universityId,
                    year: t.year,
                    yearId: t.yearId,
                    subject: t.subject,
                    charge: t.charge || "",
                    day: t.day || "",
                    timeFrom: t.timeFrom || "",
                    timeTo: t.timeTo || "",
                    description: row.introduction || "",
                    language: row.language || "English",
                });
            }

            if (t.skill) {
                flatTuitions.push({
                    email: row.email,
                    name:row.name,
                    profilePic: row.profilepic || "",

                    skill: t.skill,
                    charge: t.charge || "",
                    day: t.day || "",
                    timeFrom: t.timeFrom || "",
                    timeTo: t.timeTo || "",
                    description: row.introduction || "",
                    language: row.language || "English",
                });
            }
        }
    }
    return flatTuitions;
};




router.post("/allboards", verifyToken, async (req, res) => {
    const categoryId = req.body.category || "Subject teacher";


    try {
        const dataPath = path.join(__dirname, "../../utils/allBoards.json");
        const raw = fs.readFileSync(dataPath);
        const categories = JSON.parse(raw);

        const selectedCategory = categories.find((cat) => cat.id === categoryId);
        if (!selectedCategory) {
            return res.status(404).json({ message: `${categoryId} category not found` });
        }

        const result = await client.execute("SELECT * FROM teacher_info");
        const flatTuitions = extractTuitions(result.rows);

        if (categoryId === "Skill teacher") {

            const skills = (selectedCategory.skills || []).map((skill) => {
                const skillTeachers = flatTuitions.filter((t) => t.skill === skill.name);
                return {
                    id: skill.id,
                    name: skill.name,
                    teacherCount: skillTeachers.length,
                    teachers: skillTeachers,
                };
            });
            console.log("SK",skills)
            return res.status(200).json(skills);
        }


        if (categoryId === "Subject teacher") {
            const allBoardsWithCounts = (selectedCategory.boards || []).map((board) => {
                const boardTeachers = flatTuitions.filter((t) => t.board === board.name);

                const classes = (board.classes || []).map((cls) => {
                    const classTeachers = boardTeachers.filter((t) => t.className === cls.name);

                    const subjects = (cls.subjects || []).map((sub) => {
                        const subjectTeachers = classTeachers.filter((t) => t.subject === sub.name);

                        return {
                            id: sub.id,
                            name: sub.name,
                            teacherCount: subjectTeachers.length,
                            teachers: subjectTeachers,
                        };
                    });

                    return {
                        classId: cls.id,
                        className: cls.name,
                        teacherCount: classTeachers.length,
                        subjects,
                        teachers: classTeachers,
                    };
                });

                return {
                    boardId: board.id,
                    boardName: board.name,
                    classCount: classes.length,
                    teacherCount: boardTeachers.length,
                    classes,
                    teachers: boardTeachers,
                };
            });

            // Handle universities
            const universitiesBoard = selectedCategory.boards.find((b) => b.id === "board_universities");
            let universitiesData = [];
            
            if (universitiesBoard) {
                universitiesData = (universitiesBoard.universities || []).map((university) => {
                    const universityTeachers = flatTuitions.filter((t) => t.university === university.name);

                    const years = (university.years || []).map((year) => {
                        const yearTeachers = universityTeachers.filter((t) => t.year === year.name);

                        const subjects = (year.subjects || []).map((sub) => {
                            const subjectTeachers = yearTeachers.filter((t) => t.subject === sub.name);

                            return {
                                id: sub.id,
                                name: sub.name,
                                teacherCount: subjectTeachers.length,
                                teachers: subjectTeachers,
                            };
                        });

                        return {
                            yearId: year.id,
                            yearName: year.name,
                            teacherCount: yearTeachers.length,
                            subjects,
                            teachers: yearTeachers,
                        };
                    });

                    return {
                        universityId: university.id,
                        universityName: university.name,
                        yearCount: years.length,
                        teacherCount: universityTeachers.length,
                        years,
                        teachers: universityTeachers,
                    };
                });
            }

            return res.status(200).json({
                boards: allBoardsWithCounts,
                universities: universitiesData
            });
        }

        return res.status(200).json([]);

    } catch (error) {
        console.error(`❌ Error in /allboards (category: ${categoryId}):`, error.message);
        return res.status(500).json({ message: "Internal Server Error" });
    }
});

router.post("/teachers", verifyToken, async (req, res) => {
    const { board, className, subject } = req.body;

    if (!board || !className || !subject)
        return res.status(400).json({ message: "Board, class and subject are required" });

    try {
        const result = await client.execute("SELECT * FROM teacher_info");
        const flatTuitions = extractTuitions(result.rows).filter(
            (t) => t.board === board && t.className === className && t.subject === subject
        );

        res.json(flatTuitions);
    } catch (err) {
        console.error("Error fetching teachers:", err);
        res.status(500).json({ message: "Internal server error" });
    }
});
router.post("/teachers/skill",verifyToken,async(req,res)=>{
    const {selectedSkill} = req.body;
    if(!selectedSkill)
        return res.status(400).json({message:"Skill is required"})

    try{
        const result = await client.execute("SELECT * FROM teacher_info");
        const flatTutions = extractTuitions(result.rows).filter(
            (t)=>t.skill &&
                t.skill.toLowerCase().trim()===selectedSkill.toLowerCase().trim()
        )
        res.status(200).json(flatTutions)
    }catch(e){
        console.error("Error fetching skill teachers:",e)
        res.status(500).json({message:"Internal server error"})
    }
})
router.post("/boardId/classes",verifyToken, async (req, res) => {
    try {
        const {boardId,classId}=req.body
        const dataPath = path.join(__dirname, "../../utils/allBoards.json");
        const raw = fs.readFileSync(dataPath);
        const categories = JSON.parse(raw);

        const schooling = categories.find((cat) => cat.id === "Subject teacher");
        if (!schooling) return res.status(404).json({ error: "Schooling category not found" });

        const board = schooling.boards.find((b) => b.id === boardId);
        if (!board) return res.status(404).json({ error: "Board not found" });

        const cls = (board.classes || []).find((c) => c.id === classId);
        if (!cls) return res.status(404).json({ error: "Class not found for this board" });

        const result = await client.execute("SELECT * FROM teacher_info");
        const flatTuitions = extractTuitions(result.rows);

        const subjectList = (cls.subjects || []).map((subject) => {
            const subjectTeachers = flatTuitions.filter(
                (t) =>
                    t.board === board.name &&
                    t.className === cls.name &&
                    t.subject === subject.name
            );

            return {
                id: subject.id,
                name: subject.name,
                teacherCount: subjectTeachers.length,
            };
        });

        res.status(200).json({
            boardId: board.id,
            boardName: board.name,
            classId: cls.id,
            className: cls.name,
            subjectCount: subjectList.length,
            subjects: subjectList,
        });
    } catch (error) {
        console.error("❌ Error in /:boardId/classes/:classId:", error.message);
        res.status(500).json({ message: "Internal Server Error" });
    }
});

router.post("/teacher", verifyToken, async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: "Email is required" });

    try {
        const query = "SELECT * FROM teachers1 WHERE email = ? ALLOW FILTERING";
        const result = await client.execute(query, [email], { prepare: true });

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Teacher not found" });
        }

        const teacher = result.rows[0];
        
        teacher.qualifications = JSON.parse(teacher.qualifications || "[]");
        teacher.teachingmode = JSON.parse(teacher.teachingmode || "[]");

        // Fix: Check for both 'tuitions' (correct) and 'tutions' (typo) column names
        // Cassandra returns lowercase column names
        const tuitionsRaw = teacher.tuitions || teacher.tutions || teacher.tuitions || "[]";
        let parsedTuitions = [];
        try {
            parsedTuitions = JSON.parse(tuitionsRaw);
            console.log("✅ Parsed tuitions for", email, ":", parsedTuitions);
        } catch (parseErr) {
            console.error("❌ Failed to parse tuitions:", parseErr);
            parsedTuitions = [];
        }
        
        // Ensure each tuition has the board field properly set for Universities
        teacher.tuitions = parsedTuitions.map(t => ({
            ...t,
            // Ensure board is set for university entries
            board: t.board || (t.university ? 'Universities' : undefined)
        }));
        
        delete teacher.tutions;

        res.json(teacher);
    } catch (err) {
        console.error("Error fetching teacher:", err);
        res.status(500).json({ message: "Internal server error" });
    }
});


router.post("/board", verifyToken,async (req, res) => {
    try {
        const dataPath = path.join(__dirname, "../../utils/allBoards.json");
        const raw = fs.readFileSync(dataPath);
        const categories = JSON.parse(raw);

        const schooling = categories.find((cat) => cat.id === "Subject teacher");
        if (!schooling) return res.status(404).json({ error: "Schooling category not found" });

        const { boardId } = req.body;
        const board = schooling.boards.find((b) => b.id === boardId);
        if (!board) return res.status(404).json({ error: "Board not found" });

        const result = await client.execute("SELECT * FROM teacher_info");
        const flatTuitions = extractTuitions(result.rows);

        const classList = (board.classes || []).map((cls) => {
            const classTeachers = flatTuitions.filter(
                (t) => t.board === board.name && t.className === cls.name
            );

            return {
                classId: cls.id,
                className: cls.name,
                teacherCount: classTeachers.length,
            };
        });

        res.status(200).json({
            boardId: board.id,
            boardName: board.name,
            classCount: classList.length,
            classes: classList,
        });
    } catch (error) {
        console.error("❌ Error in /boardId", error.message);
        res.status(500).json({ message: "Internal Server Error" });
    }
});

// University endpoints
router.post("/universities", verifyToken, async (req, res) => {
    try {
        const dataPath = path.join(__dirname, "../../utils/allBoards.json");
        const raw = fs.readFileSync(dataPath);
        const categories = JSON.parse(raw);

        const schooling = categories.find((cat) => cat.id === "Subject teacher");
        if (!schooling) return res.status(404).json({ error: "Schooling category not found" });

        const universitiesBoard = schooling.boards.find((b) => b.id === "board_universities");
        if (!universitiesBoard) return res.status(404).json({ error: "Universities board not found" });

        const result = await client.execute("SELECT * FROM teacher_info");
        const flatTuitions = extractTuitions(result.rows);

        const universitiesList = (universitiesBoard.universities || []).map((university) => {
            const universityTeachers = flatTuitions.filter((t) => t.university === university.name);

            return {
                universityId: university.id,
                universityName: university.name,
                teacherCount: universityTeachers.length,
                image: university.image || null,
                location: university.location || null,
                established: university.established || null,
                type: university.type || null,
            };
        });

        res.status(200).json(universitiesList);
    } catch (error) {
        console.error("❌ Error in /universities:", error.message);
        res.status(500).json({ message: "Internal Server Error" });
    }
});

router.post("/universities/:universityId/years", verifyToken, async (req, res) => {
    try {
        const { universityId } = req.params;
        const dataPath = path.join(__dirname, "../../utils/allBoards.json");
        const raw = fs.readFileSync(dataPath);
        const categories = JSON.parse(raw);

        const schooling = categories.find((cat) => cat.id === "Subject teacher");
        if (!schooling) return res.status(404).json({ error: "Schooling category not found" });

        const universitiesBoard = schooling.boards.find((b) => b.id === "board_universities");
        if (!universitiesBoard) return res.status(404).json({ error: "Universities board not found" });

        const university = universitiesBoard.universities.find((u) => u.id === universityId);
        if (!university) return res.status(404).json({ error: "University not found" });

        const result = await client.execute("SELECT * FROM teacher_info");
        const flatTuitions = extractTuitions(result.rows);

        const yearsList = (university.years || []).map((year) => {
            const yearTeachers = flatTuitions.filter((t) => t.university === university.name && t.year === year.name);

            return {
                yearId: year.id,
                yearName: year.name,
                teacherCount: yearTeachers.length,
            };
        });

        res.status(200).json({
            universityId: university.id,
            universityName: university.name,
            years: yearsList,
        });
    } catch (error) {
        console.error("❌ Error in /universities/:universityId/years:", error.message);
        res.status(500).json({ message: "Internal Server Error" });
    }
});

router.post("/universities/:universityId/years/:yearId/subjects", verifyToken, async (req, res) => {
    try {
        const { universityId, yearId } = req.params;
        const dataPath = path.join(__dirname, "../../utils/allBoards.json");
        const raw = fs.readFileSync(dataPath);
        const categories = JSON.parse(raw);

        const schooling = categories.find((cat) => cat.id === "Subject teacher");
        if (!schooling) return res.status(404).json({ error: "Schooling category not found" });

        const universitiesBoard = schooling.boards.find((b) => b.id === "board_universities");
        if (!universitiesBoard) return res.status(404).json({ error: "Universities board not found" });

        const university = universitiesBoard.universities.find((u) => u.id === universityId);
        if (!university) return res.status(404).json({ error: "University not found" });

        const year = university.years.find((y) => y.id === yearId);
        if (!year) return res.status(404).json({ error: "Year not found" });

        const result = await client.execute("SELECT * FROM teacher_info");
        const flatTuitions = extractTuitions(result.rows);

        const subjectsList = (year.subjects || []).map((subject) => {
            const subjectTeachers = flatTuitions.filter(
                (t) => t.university === university.name && t.year === year.name && t.subject === subject.name
            );

            return {
                id: subject.id,
                name: subject.name,
                teacherCount: subjectTeachers.length,
            };
        });

        res.status(200).json({
            universityId: university.id,
            universityName: university.name,
            yearId: year.id,
            yearName: year.name,
            subjects: subjectsList,
        });
    } catch (error) {
        console.error("❌ Error in /universities/:universityId/years/:yearId/subjects:", error.message);
        res.status(500).json({ message: "Internal Server Error" });
    }
});

router.post("/universities/teachers", verifyToken, async (req, res) => {
    const { university, year, subject } = req.body;

    if (!university || !year || !subject)
        return res.status(400).json({ message: "University, year and subject are required" });

    try {
        // Query from teachers1 table to get current data
        const result = await client.execute("SELECT email, name, profilepic, introduction, tuitions FROM teachers1");
        
        const teachers = [];
        for (const row of result.rows) {
            let tuitions = row.tuitions;
            if (typeof tuitions === 'string') {
                try {
                    tuitions = JSON.parse(tuitions);
                } catch (err) {
                    console.error("Failed to parse tuitions:", err);
                    tuitions = [];
                }
            }

            if (Array.isArray(tuitions) && tuitions.length > 0) {
                const matchingTuitions = tuitions.filter(t => 
                    t.university === university && t.year === year && t.subject === subject
                );

                if (matchingTuitions.length > 0) {
                    for (const t of matchingTuitions) {
                        teachers.push({
                            email: row.email,
                            name: row.name,
                            profilePic: row.profilepic || "",
                            university: t.university,
                            universityId: t.universityId,
                            year: t.year,
                            yearId: t.yearId,
                            subject: t.subject,
                            charge: t.charge || "",
                            day: t.day || "",
                            timeFrom: t.timeFrom || "",
                            timeTo: t.timeTo || "",
                            description: row.introduction || "",
                            language: row.language || "English",
                        });
                    }
                }
            }
        }

        console.log(`📊 Found ${teachers.length} teachers for university:`, { university, year, subject });
        res.json(teachers);
    } catch (err) {
        console.error("Error fetching university teachers:", err);
        res.status(500).json({ message: "Internal server error" });
    }
});

module.exports = router;
