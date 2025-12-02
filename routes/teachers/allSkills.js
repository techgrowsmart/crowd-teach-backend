const express = require("express");
const fs = require("fs");
const path = require("path");
const skills = require('../../utils/skills.json')
const router = express.Router();


router.get("/skills", (req, res) => {
    const filePath = path.join(__dirname, skills);

    fs.readFile(filePath, "utf8", (err, data) => {
        if (err) {
            console.error("Error reading skills.json:", err);
            return res.status(500).json({ message: "Failed to load skills data" });
        }

        try {
            const skills = JSON.parse(data);
            res.json(skills);
        } catch (parseError) {
            console.error("Error parsing skills.json:", parseError);
            res.status(500).json({ message: "Error parsing skills data" });
        }
    });
});

module.exports = router;
