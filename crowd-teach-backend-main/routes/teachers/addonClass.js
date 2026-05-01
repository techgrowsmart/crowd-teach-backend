const express = require("express");
const router = express.Router();
const client = require("./../../config/db");
const verifyToken = require("./../../utils/verifyToken");
const fs = require("fs");

const classBoardData = JSON.parse(fs.readFileSync('./utils/allBoards.json', "utf8"));
async function getTeacherByEmail(email) {
    const query = "SELECT * FROM teachers1 WHERE email = ? ALLOW FILTERING";
    const result = await client.execute(query, [email], { prepare: true });
    return result.rows[0];
}

const getClassId = (boardName, className, jsonData) => {
    for (const category of jsonData) {
        if (category.name === "Subject teacher") {
            for (const board of category.boards) {
                if (board.name === boardName) {
                    for (const cls of board.classes) {
                        if (cls.name === className) {
                            return cls.id;
                        }
                    }
                }
            }
        }
    }
    return null;
};

const getSkillID = (skillName, jsonData) => {
    for (const category of jsonData) {
        if (category.name === "Skill teacher") {
            for (const skill of category.skills) {
                if (skill.name === skillName) {
                    return skill.id;
                }
            }
        }
    }
    return null;
};

router.post("/addonClass", verifyToken, async (req, res) => {
    try {
        const {
            email,
            category,
            board,
            className,
            subject,
            day,
            timeFrom,
            timeTo,
            charge = "",
            profileimage
        } = req.body;

        if (!email || !category || !subject) {
            return res.status(400).json({ message: "Missing required fields" });
        }

        const teacher = await getTeacherByEmail(email);
        if (!teacher) {
            return res.status(404).json({ message: "Teacher not found" });
        }

        let tuitionId;
        let newTuition;

        if (category === "Subject teacher") {
            if (!board || !className) {
                return res.status(400).json({ message: "Missing board or class for subject teacher" });
            }

            tuitionId = getClassId(board, className, classBoardData);
            if (!tuitionId) {
                return res.status(400).json({ message: "Invalid board or class" });
            }

            newTuition = {
                board,
                class: className,
                subject,
                timeFrom,
                timeTo,
                day,
                charge,
                classId: tuitionId,
            };

        } else if (category === "Skill teacher") {
            tuitionId = getSkillID(subject, classBoardData);
            if (!tuitionId) {
                return res.status(400).json({ message: "Invalid skill" });
            }

            newTuition = {
                subject,
                timeFrom,
                timeTo,
                day,
                charge,
                skillId: tuitionId,
            };
        } else {
            return res.status(400).json({ message: "Invalid category" });
        }

        const result = await client.execute(
            `SELECT * FROM teacher_info WHERE id = ? AND email = ?`,
            [tuitionId, email],
            { prepare: true }
        );

        let existingTuitions = [];

        if (result.rowLength > 0) {
            const row = result.first();
            existingTuitions = JSON.parse(row.tutions || "[]");

            const subjectExists = existingTuitions.some(t => t.subject === subject);

            if (!subjectExists) {
                existingTuitions.push(newTuition);

                await client.execute(
                    `UPDATE teacher_info SET tutions = ? WHERE id = ? AND email = ?`,
                    [JSON.stringify(existingTuitions), tuitionId, email],
                    { prepare: true }
                );
            }
        } else {
            await client.execute(
                `INSERT INTO teacher_info (id, email, tutions, profilePic, introduction)
                 VALUES (?, ?, ?, ?, ?)`,
                [
                    tuitionId,
                    email,
                    JSON.stringify([newTuition]),
                    teacher.profilepic || "",
                    teacher.introduction || "",
                ],
                { prepare: true }
            );
        }

        const currentTuitions = teacher.tuitions ? JSON.parse(teacher.tuitions) : [];
        currentTuitions.push(newTuition);

        await client.execute(
            `UPDATE teachers1 SET tuitions = ? WHERE email = ? AND name = ?`,
            [JSON.stringify(currentTuitions), email, teacher.name],
            { prepare: true }
        );

        res.status(201).json({ message: "Class/Skill added successfully" });
    } catch (error) {
        console.error("❌ Error adding addon class:", error);
        res.status(500).json({ message: "Internal server error" });
    }
});


function getChargeForSubject(tuitions, subject) {
    try {
        const parsed = JSON.parse(tuitions);
        const match = parsed.find((t) => t.subject === subject);
        return match?.charge.toString() || "0";
    } catch {
        return "0";
    }
}


router.get("/teacher-classes/:email", async (req, res) => {
    const { email } = req.params;

    try {
        const result = await client.execute(
            "SELECT * FROM teacher_subjects WHERE email = ? ALLOW FILTERING",
            [email],
            { prepare: true }
        );

        const classes = result.rows.map(row => ({
            board: row.board,
            class: row.class,
            subject: row.subject,
            charge: row.charge,
        }));

        res.json(classes);
    } catch (err) {
        console.error("Error fetching teacher classes:", err);
        res.status(500).json({ message: "Internal server error" });
    }
});


module.exports = router;
