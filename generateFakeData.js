const admin = require('firebase-admin');

// Initialize Firebase Admin with your service account
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://airguard-ba279-default-rtdb.firebaseio.com"
});

async function generateFakeData() {
  const userId = "Tyg7Gldx6eOJTxWPkGRUZFl1Qcl1";
  const room = "kitchen";
  
  // Define thresholds from roomsConfig
  const thresholds = {
    fresh: 800,       // 0-800
    comfortable: 1200, // 801-1200
    stale: 2000,      // 1201-2000
    unhealthy: 5000,  // 2001-5000
    critical: 10000   // 5001-10000
  };
  
  // Get current date
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  
  // Generate 24 readings with varying air quality
  for (let hour = 0; hour < 24; hour++) {
    const timestamp = new Date(now);
    timestamp.setHours(hour);
    
    // Generate value based on time of day
    let value;
    if (hour >= 0 && hour < 6) {
      // Night time: Fresh to Comfortable (400-1200)
      value = Math.floor(Math.random() * (1200 - 400) + 400);
    } 
    else if (hour >= 6 && hour < 12) {
      // Morning: Might get Stale (800-2000)
      value = Math.floor(Math.random() * (2000 - 800) + 800);
    }
    else if (hour >= 12 && hour < 18) {
      // Afternoon: Could get Unhealthy (1200-5000)
      value = Math.floor(Math.random() * (5000 - 1200) + 1200);
    }
    else {
      // Evening: Improving again (800-2000)
      value = Math.floor(Math.random() * (2000 - 800) + 800);
    }

    await admin.database().ref(`co2Readings/${userId}/${room}/${timestamp.getTime()}`).set({
      value,
      timestamp: timestamp.getTime()
    });

    // Log with air quality level
    let quality = "Fresh";
    if (value > thresholds.unhealthy) quality = "Unhealthy";
    else if (value > thresholds.stale) quality = "Stale";
    else if (value > thresholds.comfortable) quality = "Comfortable";
    
    console.log(`${timestamp.toLocaleTimeString()}: ${value} PPM (${quality})`);
  }
}

// Call the function
generateFakeData()
  .then(() => {
    console.log('Fake data generated successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('Error generating fake data:', error);
    process.exit(1);
  });