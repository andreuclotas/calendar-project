-- 1. DISABLE SAFETY CHECKS
SET FOREIGN_KEY_CHECKS = 0;

-- 2. DROP EVERYTHING
DROP TABLE IF EXISTS constructor_standings;
DROP TABLE IF EXISTS teams_standings;
DROP TABLE IF EXISTS driver_standings;
DROP TABLE IF EXISTS results_motorsport;
DROP TABLE IF EXISTS teams_motorsports;
DROP TABLE IF EXISTS constructors;
DROP TABLE IF EXISTS drivers;
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS venues;

-- 3. RE-ENABLE SAFETY CHECKS
SET FOREIGN_KEY_CHECKS = 1;

-- 4. RE-CREATE TABLES

-- Venues
CREATE TABLE venues (
    id INT AUTO_INCREMENT PRIMARY KEY,
    external_id VARCHAR(255) UNIQUE,
    name VARCHAR(255) NOT NULL,
    city VARCHAR(255),
    country VARCHAR(255),
    capacity INT,
    length_km DECIMAL(5,3),
    corners INT,
    opened_year INT
);

-- Events
CREATE TABLE events (
    id INT AUTO_INCREMENT PRIMARY KEY,
    external_id VARCHAR(255) UNIQUE,
    sport_category VARCHAR(50) NOT NULL, -- 'F1', 'MotoGP', etc.
    season INT NOT NULL,
    round INT,
    event_name VARCHAR(255) NOT NULL,
    sub_event_type VARCHAR(50), -- 'Race', 'Sprint', 'Qualifying'
    date DATETIME NOT NULL,
    venue_id INT,
    status VARCHAR(50) DEFAULT 'scheduled',
    FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE SET NULL
);

-- Drivers
CREATE TABLE drivers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    external_id VARCHAR(255) UNIQUE, 
    short_name VARCHAR(10),          
    number INT,                     
    name VARCHAR(255),               
    surname VARCHAR(255),          
    nationality VARCHAR(255),
    dob DATE,
    url VARCHAR(500)
);

-- Constructors
CREATE TABLE constructors (
    id INT AUTO_INCREMENT PRIMARY KEY,
    external_id VARCHAR(255) UNIQUE,
    name VARCHAR(255) NOT NULL,
    nationality VARCHAR(255),
    url VARCHAR(500),
    icon_url VARCHAR(500) -- Logo of the manufacturer
);

-- Teams
CREATE TABLE teams_motorsports (
    id INT AUTO_INCREMENT PRIMARY KEY,
    external_id VARCHAR(255) UNIQUE, 
    name VARCHAR(255) NOT NULL,
    constructor_id INT, -- Link to the manufacturer they use
    nationality VARCHAR(255),
    url VARCHAR(500),
    logo_url VARCHAR(500),
    
    FOREIGN KEY (constructor_id) REFERENCES constructors(id) ON DELETE SET NULL
);

-- Results
CREATE TABLE results_motorsport (
    id INT AUTO_INCREMENT PRIMARY KEY,
    event_id INT NOT NULL,           
    driver_id INT NOT NULL,          
    team_id INT NOT NULL,
    constructor_id INT,
    
    starting_position INT,          
    finish_position INT,            
    finish_position_text VARCHAR(10), 
    points DECIMAL(5,2),
    laps INT,
    race_status VARCHAR(255),       
    
    time_millis INT,
    time_text VARCHAR(255),
    
    fastest_lap_number INT,          
    fastest_lap_rank INT,
    fastest_lap_time VARCHAR(50),
    
    -- FLEXIBLE DATA COLUMN (The "JSON" Solution)
    -- Stores sport-specifics: { "q1": "1:23.4", "q2": "1:22.9", "tires": [...] }
    detailed_data JSON, 
    
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (driver_id) REFERENCES drivers(id),
    FOREIGN KEY (team_id) REFERENCES teams_motorsports(id),
    FOREIGN KEY (constructor_id) REFERENCES constructors(id),
    
    UNIQUE KEY unique_race_result (event_id, driver_id)
);

-- Driver Standings
CREATE TABLE driver_standings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    driver_id INT NOT NULL,
    season INT NOT NULL,
    position INT NOT NULL,
    points DECIMAL(6,1) NOT NULL,
    wins INT DEFAULT 0,
    round INT NOT NULL,
    team_id INT NOT NULL,
    
    FOREIGN KEY (driver_id) REFERENCES drivers(id) ON DELETE CASCADE,
    FOREIGN KEY (team_id) REFERENCES teams_motorsports(id) ON DELETE CASCADE,
    
    UNIQUE KEY unique_driver_position (driver_id, season)
);

-- Team Standings (MotoGP "Team" Championship)
CREATE TABLE teams_standings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    team_id INT NOT NULL,
    season INT NOT NULL,
    position INT NOT NULL,
    points DECIMAL(6,1) NOT NULL,
    wins INT DEFAULT 0,
    round INT NOT NULL,
    
    FOREIGN KEY (team_id) REFERENCES teams_motorsports(id) ON DELETE CASCADE,
    
    UNIQUE KEY unique_team_position (team_id, season)
);

-- Constructor Standings (NEW: F1 "Constructor" & MotoGP "Constructor" Championship)
CREATE TABLE constructor_standings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    constructor_id INT NOT NULL,
    season INT NOT NULL,
    position INT NOT NULL,
    points DECIMAL(6,1) NOT NULL,
    wins INT DEFAULT 0,
    round INT NOT NULL,
    
    FOREIGN KEY (constructor_id) REFERENCES constructors(id) ON DELETE CASCADE,
    
    UNIQUE KEY unique_constructor_position (constructor_id, season)
);


