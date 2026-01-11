// apiUsage.js
const mongoose = require("mongoose");

const apiUsageSchema = new mongoose.Schema({
  provider: { type: String, required: true }, // e.g. "AirDNA"
  count: { type: Number, default: 0 },
  month: { type: String, required: true }, // Format: "YYYY-MM" e.g. "2024-12"
  lastUpdated: { type: Date, default: Date.now }
});

// Create compound index for provider and month
apiUsageSchema.index({ provider: 1, month: 1 }, { unique: true });

module.exports = mongoose.model("ApiUsage", apiUsageSchema);