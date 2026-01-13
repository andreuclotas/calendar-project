// controllers/f1Controller.js
const axios = require("axios");
const pool = require("../config/db");

// --- HELPER FUNCTIONS ---

async function getOrCreateVenue(venueData) {
  const { id: external_id, name, city, country } = venueData;
  const [rows] = await pool.query("SELECT id FROM venues WHERE external_id = ?", [external_id]);
  if (rows.length > 0) return rows[0].id;

  const [result] = await pool.query(
    "INSERT INTO venues (external_id, name, city, country) VALUES (?, ?, ?, ?)",
    [external_id, name, city, country]
  );
  return result.insertId;
}

// FIX: Helper to create drivers if they don't exist (Prevents "driver_id cannot be null" error)
async function getOrCreateDriver(driverData) {
  const { driverId, code, permanentNumber, givenName, familyName, nationality, dateOfBirth, url } = driverData;

  const [rows] = await pool.query("SELECT id FROM drivers WHERE external_id = ?", [driverId]);
  
  if (rows.length > 0) {
    return rows[0].id;
  } else {
    // Insert new driver (e.g., Colapinto) if missing
    const [result] = await pool.query(
      "INSERT INTO drivers (external_id, short_name, number, name, surname, nationality, dob, url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [driverId, code, permanentNumber, givenName, familyName, nationality, dateOfBirth, url]
    );
    return result.insertId;
  }
}

async function getOrCreateConstructorAndTeam(f1ConstructorData) {
  const { constructorId, name, nationality, url } = f1ConstructorData;

  // 1. Get or Create CONSTRUCTOR
  let constructorIdDb;
  const [exConst] = await pool.query("SELECT id FROM constructors WHERE external_id = ?", [constructorId]);
  
  if (exConst.length > 0) {
    constructorIdDb = exConst[0].id;
  } else {
    const [newConst] = await pool.query(
      "INSERT INTO constructors (external_id, name, nationality, url) VALUES (?, ?, ?, ?)",
      [constructorId, name, nationality, url]
    );
    constructorIdDb = newConst.insertId;
  }

  // 2. Get or Create TEAM
  let teamIdDb;
  const [exTeam] = await pool.query("SELECT id FROM teams_motorsports WHERE external_id = ?", [constructorId]);
  
  if (exTeam.length > 0) {
    teamIdDb = exTeam[0].id;
    await pool.query("UPDATE teams_motorsports SET constructor_id = ? WHERE id = ?", [constructorIdDb, teamIdDb]);
  } else {
    const [newTeam] = await pool.query(
      "INSERT INTO teams_motorsports (external_id, name, nationality, url, constructor_id) VALUES (?, ?, ?, ?, ?)",
      [constructorId, name, nationality, url, constructorIdDb]
    );
    teamIdDb = newTeam.insertId;
  }

  return { teamId: teamIdDb, constructorId: constructorIdDb };
}


// --- CONTROLLERS ---

exports.getSchedule = async (req, res) => {
  const currentSeason = 2025;

  try {
    const [rows] = await pool.query(`
      SELECT e.*, v.name as venue_name, v.city, v.country
      FROM events e
      LEFT JOIN venues v ON e.venue_id = v.id
      WHERE e.sport_category = 'F1' AND e.season = ?
      ORDER BY e.date ASC
    `, [currentSeason]);

    if (rows.length > 0) {
      return res.json(rows);
    }

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
    };

    for (const race of apiRaces) {
      const venueId = await getOrCreateVenue({
        id: race.Circuit.circuitId,
        name: race.Circuit.circuitName,
        city: race.Circuit.Location.locality,
        country: race.Circuit.Location.country
      });

      const raceDate = `${race.date}T${race.time || "14:00:00Z"}`;
      await pool.query(`
        INSERT IGNORE INTO events 
        (external_id, sport_category, season, round, event_name, sub_event_type, date, venue_id)
        VALUES (?, 'F1', ?, ?, ?, 'Race', ?, ?)`,
        [`${currentSeason}-${race.round}-race`, race.season, race.round, race.raceName, raceDate, venueId]
      );

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
    `, [currentSeason]);
    res.json(newRows);

  } catch (error) {
    console.error("Error fetching F1 schedule:", error);
    res.status(500).json({ error: "Failed to fetch F1 schedule" });
  }
};

exports.importResults = async (req, res) => {
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

    if (events.length === 0) return res.status(404).json({ message: "Event not found in database" });
    const eventId = events[0].id;

    let savedCount = 0;
    for (const resData of raceData.Results) {
      
      // FIX: Use the helper to ensure driver exists
      const driverId = await getOrCreateDriver(resData.Driver);

      const { teamId, constructorId } = await getOrCreateConstructorAndTeam(resData.Constructor);

      const detailedData = {
        time_details: resData.Time || null,
        fastest_lap_details: resData.FastestLap || null,
        grid_original: resData.grid
      };

      const fl = resData.FastestLap || {};
      
      await pool.query(`
        INSERT INTO results_motorsport 
        (event_id, driver_id, team_id, constructor_id, starting_position, finish_position, finish_position_text, points, laps, race_status, 
         time_millis, time_text, fastest_lap_number, fastest_lap_rank, fastest_lap_time, detailed_data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE 
          finish_position = VALUES(finish_position), 
          points = VALUES(points),
          detailed_data = VALUES(detailed_data)
        `,
        [
          eventId, driverId, teamId, constructorId,
          resData.grid, resData.position, resData.positionText, resData.points, resData.laps, resData.status,
          resData.Time?.millis, resData.Time?.time, fl.lap, fl.rank, fl.Time?.time, 
          JSON.stringify(detailedData)
        ]
      );
      savedCount++;
    }

    res.json({ message: `Imported ${savedCount} results`, raceName: raceData.raceName });

  } catch (error) {
    console.error("Importing F1 results error:", error);
    res.status(500).json({ error: "Failed to import F1 results" });
  }
};

exports.getResults = async (req, res) => {
  const { season, round } = req.params;
  try {
    const query = `
      SELECT 
        r.finish_position as position,
        r.finish_position_text as position_text,
        r.points, r.time_text, r.race_status as status, 
        d.name as driver_name, d.surname as driver_surname, d.number as driver_number, 
        t.name as team_name, c.name as constructor_name,
        r.detailed_data
      FROM results_motorsport r
      JOIN drivers d ON r.driver_id = d.id
      JOIN teams_motorsports t ON r.team_id = t.id
      LEFT JOIN constructors c ON r.constructor_id = c.id
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
};

// 4. GET DRIVER STANDINGS (The Logic That Was Crashing)
exports.getDriverStandings = async (req, res) => {
  const { season } = req.params;
  try {
    // 1. Check DB cache
    const [saved] = await pool.query(`SELECT COUNT(*) as count, MAX(round) as round FROM driver_standings WHERE season = ?`, [season]);
    const [last] = await pool.query(`
      SELECT MAX(round) as round FROM events 
      WHERE sport_category = 'F1' AND season = ? AND sub_event_type = 'Race' AND date <= NOW()
    `, [season]);

    const latestRound = last[0]?.round || 0;
    const savedRound = saved[0]?.round || -1;
    const driverCount = saved[0]?.count || 0;

    // FIX: Only return cache if we have a reasonable amount of drivers (e.g. > 15)
    // This prevents serving the "partial list" that caused your issue
    if (driverCount > 15 && savedRound == latestRound) {
      const [rows] = await pool.query(`
        SELECT ds.position, ds.points, ds.wins, 
               d.external_id as driver_id, d.name, d.surname, 
               tm.name as team_name
        FROM driver_standings ds
        JOIN drivers d ON ds.driver_id = d.id
        JOIN teams_motorsports tm ON ds.team_id = tm.id
        WHERE ds.season = ? ORDER BY ds.position ASC
      `, [season]);
      return res.json(rows);
    }

    // 2. Fetch API
    const response = await axios.get(`http://api.jolpi.ca/ergast/f1/${season}/driverstandings.json`);
    if (!response.data.MRData.StandingsTable.StandingsLists.length) {
        return res.json([]);
    }
    const listData = response.data.MRData.StandingsTable.StandingsLists[0];
    const currentRound = listData.round;
    const driverStandings = listData.DriverStandings;

    res.json(driverStandings);

    // 3. Save to DB (Now using the Helper to prevent crashes)
    for (const d of driverStandings) {
      // THIS FUNCTION PREVENTS THE CRASH:
      const driverId = await getOrCreateDriver(d.Driver);

      const teamData = d.Constructors[0];
      const { teamId } = await getOrCreateConstructorAndTeam(teamData);

      await pool.query(`
        INSERT INTO driver_standings (driver_id, season, position, points, wins, round, team_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE position=VALUES(position), points=VALUES(points), wins=VALUES(wins), round=VALUES(round), team_id=VALUES(team_id)
        `, [driverId, season, d.position, d.points, d.wins, currentRound, teamId]
      );
    }
  } catch (error) {
    console.error("Fetching F1 driver standings error:", error);
    if (!res.headersSent) res.status(500).json({ error: "Failed to fetch F1 driver standings" });
  }
};

exports.getTeamStandings = async (req, res) => {
  const { season } = req.params;
  try {
    const [saved] = await pool.query(`SELECT round FROM constructor_standings WHERE season = ? LIMIT 1`, [season]);
    const [last] = await pool.query(`
      SELECT MAX(round) as round FROM events 
      WHERE sport_category = 'F1' AND season = ? AND sub_event_type = 'Race' AND date <= NOW()
    `, [season]);

    const latestRound = last[0]?.round || 0;
    const savedRound = saved[0]?.round || -1;

    if (saved.length > 0 && savedRound == latestRound) {
      const [rows] = await pool.query(`
        SELECT cs.position, cs.points, cs.wins, c.name as team_name
        FROM constructor_standings cs
        JOIN constructors c ON cs.constructor_id = c.id
        WHERE cs.season = ? ORDER BY cs.position ASC
      `, [season]);
      return res.json(rows);
    }

    const response = await axios.get(`http://api.jolpi.ca/ergast/f1/${season}/constructorstandings.json`);
    if (!response.data.MRData.StandingsTable.StandingsLists.length) {
        return res.json([]);
    }
    const listData = response.data.MRData.StandingsTable.StandingsLists[0];
    const currentRound = listData.round;
    const teamsStandings = listData.ConstructorStandings;

    res.json(teamsStandings);

    for (const t of teamsStandings) {
      const { teamId, constructorId } = await getOrCreateConstructorAndTeam(t.Constructor);

      await pool.query(`
        INSERT INTO constructor_standings (constructor_id, season, position, points, wins, round)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE position=VALUES(position), points=VALUES(points), wins=VALUES(wins), round=VALUES(round)
        `, [constructorId, season, t.position, t.points, t.wins, currentRound]
      );

      await pool.query(`
        INSERT INTO teams_standings (team_id, season, position, points, wins, round)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE position=VALUES(position), points=VALUES(points), wins=VALUES(wins), round=VALUES(round)
        `, [teamId, season, t.position, t.points, t.wins, currentRound]
      );
    }

  } catch (error) {
    console.error("Fetching F1 team standings error:", error);
    if (!res.headersSent) res.status(500).json({ error: "Failed to fetch F1 team standings" });
  }
};