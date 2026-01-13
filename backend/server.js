// server.js
const express = require("express");
const cors = require("cors");
const f1Routes = require("./routes/f1Routes");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use("/api/f1", f1Routes);

// Base route
app.get("/", (req, res) => {
  res.send("Sports API is running...");
});

// Start Server
const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});