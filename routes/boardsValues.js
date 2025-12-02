
const express = require("express");
const router = express.Router();
const fs = require("fs");
const path = require("path");


router.get("/valuesToselect", (req, res) => {
    const filePath = path.join(__dirname, "../utils/allBoards.json");
    fs.readFile(filePath, "utf8", (err, data) => {
        if (err) return res.status(500).send("Error reading JSON");
        res.json(JSON.parse(data));
    });
});

module.exports = router;
