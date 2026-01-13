// routes/f1Routes.js
const express = require("express");
const router = express.Router();
const f1Controller = require("../controllers/f1Controller");

// Schedule
router.get("/schedule", f1Controller.getSchedule);

// Results
// Note: The import logic had no "/view" in your original code, and the view logic did.
router.get("/results/:season/:round", f1Controller.importResults); 
router.get("/results/:season/:round/view", f1Controller.getResults);

// Standings
router.get("/standings/drivers/:season", f1Controller.getDriverStandings);
router.get("/standings/teams/:season", f1Controller.getTeamStandings);

module.exports = router;