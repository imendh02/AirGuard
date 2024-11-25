const admin = require('firebase-admin');

const co2Service = {
  storeCO2Reading: async (userId, room, value, type) => {
    try {
      const timestamp = Date.now();
      await admin.database().ref(`co2Readings/${userId}/${room}/${timestamp}`).set({
        value,
        timestamp,
        type
      });
    } catch (error) {
      console.error('Error storing CO2 reading:', error);
    }
  },

  getCO2Readings: async (userId, room) => {
    try {
      const snapshot = await admin.database()
        .ref(`co2Readings/${userId}/${room}`)
        .once('value');
      
      const data = snapshot.val();
      if (!data) return [];

      return Object.entries(data).map(([timestamp, reading]) => ({
        timestamp: parseInt(timestamp),
        ...reading
      })).sort((a, b) => a.timestamp - b.timestamp);
      
    } catch (error) {
      console.error('Error getting CO2 readings:', error);
      return [];
    }
  }
};

module.exports = co2Service;