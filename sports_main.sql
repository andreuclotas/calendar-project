-- 1. DISABLE SAFETY CHECKS (The Nuclear Option)
SET FOREIGN_KEY_CHECKS = 0;

-- 2. DROP EVERYTHING (Forcefully)
DROP TABLE IF EXISTS teams_standings;
DROP TABLE IF EXISTS driver_standings;
DROP TABLE IF EXISTS results_motorsport;
DROP TABLE IF EXISTS teams_motorsports;
DROP TABLE IF EXISTS drivers;
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS venues;

-- 3. RE-ENABLE SAFETY CHECKS
SET FOREIGN_KEY_CHECKS = 1;

-- 4. RE-CREATE TABLES (Clean)

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
    sport_category VARCHAR(50) NOT NULL,
    season INT NOT NULL,
    round INT,
    event_name VARCHAR(255) NOT NULL,
    sub_event_type VARCHAR(50),
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

-- Teams
CREATE TABLE teams_motorsports (
    id INT AUTO_INCREMENT PRIMARY KEY,
    external_id VARCHAR(255) UNIQUE, 
    name VARCHAR(255) NOT NULL,
    nationality VARCHAR(255),
    url VARCHAR(500)
);

-- Results
CREATE TABLE results_motorsport (
    id INT AUTO_INCREMENT PRIMARY KEY,
    event_id INT NOT NULL,           
    driver_id INT NOT NULL,          
    team_id INT NOT NULL,            
    
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
    
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (driver_id) REFERENCES drivers(id),
    FOREIGN KEY (team_id) REFERENCES teams_motorsports(id),
    
    UNIQUE KEY unique_race_result (event_id, driver_id)
);

-- driver standings
create table driver_standings (
	id int auto_increment primary key,
	driver_id int not null,
	season int not null,
	position int not null,
	points decimal(6,1) not null,
	wins int default 0,
	round int not null,
	team_id int not null,
	
	foreign key (driver_id) references drivers(id) on delete cascade,
	foreign key (team_id) references teams_motorsports(id) on delete cascade,
	
	unique key unique_driver_position (driver_id, season)
);

-- motorsport teams standings
CREATE TABLE teams_standings (
	id int auto_increment primary key,
	team_id int not null,
	season int not null,
	position int not null,
	points decimal(6,1) not null,
	wins int default 0,
	round int not null,
	
	foreign key (team_id) references teams_motorsports(id) on delete cascade,
	
	unique key unique_team_position (team_id, season)
);