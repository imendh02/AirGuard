const express = require("express");
const bodyParser = require("body-parser");
const mqtt = require("mqtt");
const app = express();
const admin = require("firebase-admin");
const co2Service = require("./co2Service");
require("dotenv").config();
let userConnected;
let connectedUserId = null;
let publishInterval = null;
let storageInterval = null;
app.use(bodyParser.json());

// Define room-specific CO2 ranges and behaviors
const roomConfigs = {
  kitchen: {
    basePPM: 4000,
    minPPM: 400,
    maxPPM: 8000,
    resolution: 300,  // Larger fluctuations due to cooking activities
  },
  livingRoom: {
    basePPM: 600,
    minPPM: 400,
    maxPPM: 6000,
    resolution: 200,  // Moderate fluctuations
  },
  bedroom: {
    basePPM: 500,
    minPPM: 400,
    maxPPM: 4000,
    resolution: 100,  // Smaller fluctuations for stable environment
  },
  bathroom: {
    basePPM: 700,
    minPPM: 400,
    maxPPM: 5000,
    resolution: 400,  // Larger fluctuations due to humidity and usage patterns
  }
};

// Track current PPM for each room
const currentPPMs = {
  kitchen: roomConfigs.kitchen.basePPM,
  livingRoom: roomConfigs.livingRoom.basePPM,
  bedroom: roomConfigs.bedroom.basePPM,
  bathroom: roomConfigs.bathroom.basePPM
};

function generateCO2Value(room) {
  const config = roomConfigs[room];
  const currentPPM = currentPPMs[room];
  
  // Generate random step within room-specific resolution limits
  const step = Math.random() * (config.resolution * 2) - config.resolution;

  // Calculate new value
  let newPPM = currentPPM + step;

  // Ensure value stays within room-specific bounds
  newPPM = Math.max(config.minPPM, Math.min(config.maxPPM, newPPM));

  // Update current value for this room
  currentPPMs[room] = newPPM;

  return Math.round(newPPM);
}

const rooms = ["kitchen", "livingRoom", "bedroom", "bathroom"];

// Object to store latest CO2 values for each room
const latestCO2Values = {};

// Time intervals (in milliseconds)
const ONE_SECOND = 1000;
const ONE_HOUR = 60 * 60 * 1000; // 3600000 ms = 1 hour

// Initialize Firebase Admin
const serviceAccount = require("./serviceAccountKey.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://airguard-ba279-default-rtdb.firebaseio.com",
});

// MQTT client setup
const mqttClient = mqtt.connect("mqtt://broker.hivemq.com");
mqttClient.on("connect", () => {
  console.log("Connected to MQTT broker");
});

mqttClient.on("error", (err) => {
  console.error("MQTT connection error:", err);
});

app.get("/api/co2readings/:userId/:room", async (req, res) => {
  try {
    const { userId, room } = req.params;
    const readings = await co2Service.getCO2Readings(userId, room);
    console.log(readings)
    res.json(readings);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Failed to fetch readings" });
  }
});

// Add new endpoint to set connected user
app.post("/api/user/connect", async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    // Clear existing intervals if any
    if (publishInterval) clearInterval(publishInterval);
    if (storageInterval) clearInterval(storageInterval);

    // Set new connected user
    connectedUserId = userId;
    console.log(`User ${userId} connected`);

    // Start publishing CO2 values for this user
    publishInterval = setInterval(() => {
      rooms.forEach((room) => {
        const co2Value = generateCO2Value(room);
        latestCO2Values[room] = co2Value;
        mqttClient.publish(`imen/AQ/${room}`, co2Value.toString());
        // Store each reading using co2Service
        console.log(`${room} CO2 Value:`, co2Value, "ppm");
      });
    }, ONE_SECOND);

    // Modify the hourly storage to include type
    storageInterval = setInterval(() => {
      const now = new Date();
      console.log(`Storing hourly data at: ${now.toLocaleTimeString()}`);

      rooms.forEach((room) => {
        const co2Value = latestCO2Values[room];
        co2Service.storeCO2Reading(userId, room, co2Value);
        console.log(`Storing hourly data - ${room}:`, co2Value, "ppm");
      });
    }, ONE_HOUR);

    // Store initial readings with type
    rooms.forEach((room) => {
      const co2Value = generateCO2Value(room);
      latestCO2Values[room] = co2Value;

      console.log(`Storing initial reading - ${room}:`, co2Value, "ppm");
    });

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Error connecting user:", error);
    res.status(500).json({ error: "Failed to connect user" });
  }
});

// Add disconnect endpoint
app.post("/api/user/disconnect", async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (userId !== connectedUserId) {
      return res.status(400).json({ error: "User not connected" });
    }

    // Clear intervals
    if (publishInterval) clearInterval(publishInterval);
    if (storageInterval) clearInterval(storageInterval);

    // Reset connected user
    connectedUserId = null;
    console.log(`User ${userId} disconnected`);

    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Error disconnecting user:", error);
    res.status(500).json({ error: "Failed to disconnect user" });
  }
});

// Update room toggle endpoint to use connected user
app.post("/api/rooms/toggle", async (req, res) => {
  try {
    const { roomKey, isActive } = req.body;
    
    if (!connectedUserId) {
      return res.status(400).json({ error: "No user connected" });
    }

    // Update Firebase Realtime Database
    await admin
      .database()
      .ref(`users/${connectedUserId}/activeRooms/${roomKey}`)
      .set(isActive);

    // If room is deactivated, stop sending MQTT messages for that room
    if (!isActive) {
      mqttClient.publish(`imen/AQ/${connectedUserId}/${roomKey}`, "0");
      latestCO2Values[roomKey] = 0;
    }

    res.status(200).json({
      success: true,
      message: `Room ${roomKey} ${isActive ? "activated" : "deactivated"}`,
    });
  } catch (error) {
    console.error("Error toggling room:", error);
    res.status(500).json({ error: "Failed to toggle room state" });
  }
});

app.get("/api/rooms/states/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Get room states from Firebase
    const snapshot = await admin
      .database()
      .ref(`users/${userId}/activeRooms`)
      .once('value');
    
    const roomStates = snapshot.val() || {};
    
    // If no room states exist, initialize with all rooms active
    if (Object.keys(roomStates).length === 0) {
      const initialStates = rooms.reduce((acc, roomKey) => ({
        ...acc,
        [roomKey]: true
      }), {});

      // Store initial states in Firebase
      await admin
        .database()
        .ref(`users/${userId}/activeRooms`)
        .set(initialStates);

      res.status(200).json(initialStates);
    } else {
      res.status(200).json(roomStates);
    }

  } catch (error) {
    console.error("Error fetching room states:", error);
    res.status(500).json({ 
      success: false, 
      error: "Failed to fetch room states" 
    });
  }
});

app.listen(3000, () => {
  console.log("Server ready on port 3000.");
});

module.exports = app;
