const express = require("express");
const router = express.Router();
const { getHouseData } = require("../controllers/houseController");
const ApiUsage = require("../models/ApiUsage");
const {checkSubscriptionAndTrackUsage, trackApiUsage} = require("../middleware/check");
const User = require("../models/User")
router.post("/house", checkSubscriptionAndTrackUsage, trackApiUsage ,getHouseData);

// Get user API usage stats
router.get("/user/usage", checkSubscriptionAndTrackUsage, async (req, res) => {
  try {
    
    const user = await User.findById(req.user._id).select('apiUsage monthlyLimit');
    
    res.json({
      success: true,
      usage: user.apiUsage || {
        monthlyRequests: 0,
        currentMonth: new Date().toISOString().slice(0, 7),
        totalRequests: 0
      },
      limit: user.monthlyLimit,
      remaining: user.monthlyLimit - (user.apiUsage?.monthlyRequests || 0)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch usage data"
    });
  }
});

// Optional: Get all monthly usage
router.get("/usage/all", async (req, res) => {
  const allUsage = await ApiUsage.find({ provider: "AirDNA" }).sort({ month: -1 });
  res.json(allUsage);
});

module.exports = router;
