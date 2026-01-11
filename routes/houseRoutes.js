const express = require("express");
const router = express.Router();
const { getHouseData } = require("../controllers/houseController");
const ApiUsage = require("../models/ApiUsage");
router.post("/house", getHouseData);

// Check API usage - with backward compatibility
router.get("/usage", async (req, res) => {
  try {
    const currentMonth = new Date().toISOString().slice(0, 7);
    
    // First, check if we have old schema data that needs migration
    const oldUsage = await ApiUsage.findOne({ 
      provider: "AirDNA", 
      month: { $exists: false } 
    });
    
    // If old data exists, migrate it
    if (oldUsage) {
      
      // Create new document with month field
      const migrationMonth = oldUsage.lastUpdated.toISOString().slice(0, 7);
      await ApiUsage.create({
        provider: "AirDNA",
        count: oldUsage.count,
        month: migrationMonth,
        lastUpdated: oldUsage.lastUpdated
      });
      
      // Remove the old document
      await ApiUsage.findByIdAndDelete(oldUsage._id);
      
    }
    
    // Now get current month's usage
    const usage = await ApiUsage.findOne({ 
      provider: "AirDNA", 
      month: currentMonth 
    });
    
    res.json(usage || { provider: "AirDNA", count: 0, month: currentMonth });
    
  } catch (error) {
    console.error('Error in usage route:', error);
    res.status(500).json({ error: "Server error" });
  }
});

// Optional: Get all monthly usage
router.get("/usage/all", async (req, res) => {
  const allUsage = await ApiUsage.find({ provider: "AirDNA" }).sort({ month: -1 });
  res.json(allUsage);
});

module.exports = router;
