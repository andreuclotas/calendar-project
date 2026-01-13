const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const axios = require("axios");

const app = express();
app.use(cors());
app.use(express.json());

const pool = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "1234",
  database: "sports_db",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: "+00:00"
});

// save a new venue and return the id
async function getOrCreateVenue(venueData){
  const{ id: external_id, name, city, country, url } = venueData;

  // check if venue exists
  const[rows] = await pool.query("SELECT id FROM venues WHERE external_id = ?", [external_id]);
  if(rows.length > 0){
    return rows[0].id;
  }

  // insert new venue
  const[result] = await pool.query(
    "INSERT INTO venues (external_id, name, city, country) VALUES (?, ?, ?, ?)",
    [external_id, name, city, country]
  );
  return result.insertId;
}

app.get("/api/f1/schedule", async (req, res) => {
  const currentSeason = 2025;
  //const currentSeason = new Date().getFullYear();

  
  try {
    // check if we have current year in DB
    const [rows] = await pool.query(`
      SELECT e.*, v.name as venue_name, v.city, v.country
      FROM events e
      LEFT JOIN venues v ON e.venue_id = v.id
      WHERE e.sport_category = 'F1' AND e.season = ?
      ORDER BY e.date ASC
    `, [currentSeason]
    );

    // if we have data, return it
    if (rows.length > 0) {
      console.log("F1 Schedule fetched from DB");
      return res.json(rows);
    }

    // else fetch from external API
    console.log("Fetching F1 Schedule from external API");
    const response = await axios.get(`http://api.jolpi.ca/ergast/f1/${currentSeason}.json`);
    const apiRaces = response.data.MRData.RaceTable.Races;

    const sessionMap = {
      FirstPractice: "FP1",
      SecondPractice: "FP2",
      ThirdPractice: "FP3",
      Qualifying: "Qualifying",
      Sprint: "Sprint",
      SprintQualifying: "Sprint Qualifying"
    }

    // save new data to DB
    for (const race of apiRaces) {

      // get or create venue
      const venueId = await getOrCreateVenue({
        id:race.Circuit.circuitId,
        name: race.Circuit.circuitName,
        city: race.Circuit.Location.locality,
        country: race.Circuit.Location.country
      });

      // insert main race
      const raceDate = `${race.date}T${race.time || "14:00:00Z"}`;
      await pool.query(`
        INSERT IGNORE INTO events 
        (external_id, sport_category, season, round, event_name, sub_event_type, date, venue_id)
        VALUES (?, 'F1', ?, ?, ?, 'Race', ?, ?)`,
        [`${currentSeason}-${race.round}-race`, race.season, race.round, race.raceName, raceDate, venueId]
      );

      // insert other sessions
      for (const [apiKey, dbType] of Object.entries(sessionMap)) {
        if (race[apiKey]) {
          const sessionData = race[apiKey];
          const sessionDate = `${sessionData.date}T${sessionData.time || "12:00:00Z"}`;
          await pool.query(`
            INSERT IGNORE INTO events 
            (external_id, sport_category, season, round, event_name, sub_event_type, date, venue_id)
            VALUES (?, 'F1', ?, ?, ?, ?, ?, ?)`,
            [`${currentSeason}-${race.round}-${dbType.replace(/\s+/g, '').toLowerCase()}`,
              race.season, race.round, race.raceName, dbType, sessionDate, venueId]
          );
        }
      }
    }

    const [newRows] = await pool.query(`
      SELECT e.*, v.name as venue_name
      FROM events e
      LEFT JOIN venues v ON e.venue_id = v.id
      WHERE e.sport_category = 'F1' AND e.season = ?
      ORDER BY e.date ASC
    `, [currentSeason]
    );
    res.json(newRows);
  } catch (error) {
    console.error("Error fetching F1 schedule:", error);
    res.status(500).json({ error: "Failed to fetch F1 schedule" });
  }
});

// session results

app.get("/api/f1/results/:season/:round", async (req, res) => {
  const { season, round } = req.params;

  try {
    const response = await axios.get(`http://api.jolpi.ca/ergast/f1/${season}/${round}/results.json`);

    if (!response.data.MRData.RaceTable.Races.length) {
      return res.status(404).json({ message: "Race results not found" });
    }

    const raceData = response.data.MRData.RaceTable.Races[0];

    const [events] = await pool.query(
      "SELECT id FROM events WHERE season = ? AND round = ? AND sport_category = 'F1' AND sub_event_type = 'Race'",
      [season, round]
    );

    if (events.length === 0) {
      return res.status(404).json({ message: "Event not found in database" });
    }

    const eventId = events[0].id;

    let savedCount = 0;
    for (const resData of raceData.Results) {
      const driver = resData.Driver;
      const team = resData.Constructor;

      // save driver
      let driverId;
      const[exDriver] = await pool.query("SELECT id FROM drivers WHERE external_id = ?", [driver.driverId]);
      if(exDriver.length > 0){
        driverId = exDriver[0].id;
      } else {
        const [newDriver] = await pool.query(
          "INSERT INTO drivers (external_id, short_name, number, name, surname, nationality, dob, url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          [driver.driverId, driver.code, driver.permanentNumber, driver.givenName, driver.familyName, driver.nationality, driver.dateOfBirth, driver.url]
        );
        driverId = newDriver.insertId;
      }

      // save team
      let teamId;
      const[exTeam] = await pool.query("SELECT id FROM teams_motorsports WHERE external_id = ?", [team.constructorId]);

      if(exTeam.length > 0){
        teamId = exTeam[0].id;
      } else {
        const [newTeam] = await pool.query(
          "INSERT INTO teams_motorsports (external_id, name, nationality, url) VALUES (?, ?, ?, ?)",
          [team.constructorId, team.name, team.nationality, team.url]
        );  
        teamId = newTeam.insertId;
      }

      // save result

      const fl = resData.FastestLap || {};
      await pool.query(`
        INSERT INTO results_motorsport 
        (event_id, driver_id, team_id, starting_position, finish_position, finish_position_text, points, laps, race_status, 
         time_millis, time_text, fastest_lap_number, fastest_lap_rank, fastest_lap_time)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE finish_position = VALUES(finish_position), points = VALUES(points)`,
        [
          eventId, driverId, teamId,
          resData.grid,          // -> starting_position
          resData.position,      // -> finish_position
          resData.positionText,  // -> finish_position_text
          resData.points,
          resData.laps,
          resData.status,        // -> race_status
          resData.Time?.millis,
          resData.Time?.time,
          fl.lap,                // -> fastest_lap_number
          fl.rank,               // -> fastest_lap_rank
          fl.Time?.time
        ]
      );
      savedCount++;
    }

    console.log(`Saved ${savedCount} results for F1 ${season} Round ${round}`);
    res.json({ message: `Imported ${savedCount} results`, raceName: raceData.raceName });

  } catch (error) {
    console.error("Importing F1 results error:", error);
    res.status(500).json({ error: "Failed to import F1 results" });
  }
});

// view results

app.get("/api/f1/results/:season/:round/view", async (req, res) => {
  const { season, round } = req.params;
  try {
    const query = `
      SELECT 
        r.finish_position as position,
        r.finish_position_text as position_text,
        r.points, 
        r.time_text, 
        r.race_status as status, 
        d.name as driver_name, 
        d.surname as driver_surname, 
        d.number as driver_number, 
        t.name as team_name
      FROM results_motorsport r
      JOIN drivers d ON r.driver_id = d.id
      JOIN teams_motorsports t ON r.team_id = t.id
      JOIN events e ON r.event_id = e.id
      WHERE e.season = ? AND e.round = ? AND e.sport_category = 'F1' AND e.sub_event_type = 'Race'
      ORDER BY r.finish_position ASC
    `;
    const [rows] = await pool.query(query, [season, round]);
    res.json(rows);
  } catch (error) {
    console.error("Fetching F1 results error:", error);
    res.status(500).json({ error: "Failed to fetch F1 results" });
  }
});

app.get("/api/standings/drivers/:season", async (req, res) => {
  const { season } = req.params;
  try {
    const response = await axios.get(`http://api.jolpi.ca/eargast/f1/${season}/driverstandings.json`);
    if (!response.data.MRData.StandingsTable.StandingsLists.length) {
      return res.status(404).json({ message: "Driver standings not found" });
    }
    const driverStandings = response.data.MRData.StandingsTable.StandingsLists[0].DriverStandings;
    res.json(driverStandings);

  } catch (error) {
    console.error("Fetching F1 driver standings error:", error);
    res.status(500).json({ error: "Failed to fetch F1 driver standings" });
  }
});

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});