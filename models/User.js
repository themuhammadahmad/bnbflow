const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

// Add these fields to your User schema
const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  stripeCustomerId: String,
  subscriptionActive: { type: Boolean, default: false },
  subscriptionId: String,
  
  // Add API usage tracking
  apiUsage: {
    monthlyRequests: { type: Number, default: 0 },
    currentMonth: { type: String, default: "" }, // Format: "YYYY-MM"
    totalRequests: { type: Number, default: 0 },
    lastRequestDate: { type: Date }
  },
  
  // Optional: Usage limits
  monthlyLimit: { type: Number, default: 100 }, // 100 requests per month by default
  
  createdAt: { type: Date, default: Date.now }
});

// Hash password
userSchema.pre("save", async function(next) {
  if (this.isModified("password")) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  next();
});

module.exports = mongoose.model("User", userSchema);