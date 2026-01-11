const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const UserSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  stripeCustomerId: String,
  subscriptionActive: { type: Boolean, default: false },
  subscriptionId: String,
  createdAt: { type: Date, default: Date.now }
});

// Hash password
UserSchema.pre("save", async function(next) {
  if (this.isModified("password")) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  next();
});

module.exports = mongoose.model("User", UserSchema);