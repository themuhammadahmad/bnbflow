const mongoose = require("mongoose");

const houseSchema = new mongoose.Schema({
  address: { type: String, required: true, unique: true },
  bedrooms: { type: Number },
  bathrooms: { type: Number },
  accommodates: { type: Number },
  adr: { type: Number },        // Average Daily Rate from AirDNA
  revenue: { type: Number },    // Revenue from AirDNA
  occupancy: { type: Number },  // Occupancy from AirDNA
  lastFetched: { type: Date, default: Date.now }
});

module.exports = mongoose.model("House", houseSchema);
