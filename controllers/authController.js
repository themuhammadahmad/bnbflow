const User = require("../models/User");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// Register user
exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Check if user exists
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({
        success: false,
        error: "User already exists"
      });
    }

    // Create user
    const user = await User.create({
      name,
      email,
      password
    });

    // Create token
    const token = user.getSignedJwtToken();

    res.status(201).json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        stripeCustomerId: user.stripeCustomerId,
        subscription: user.subscription
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Server error"
    });
  }
};

// Login user
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Check for user
    const user = await User.findOne({ email }).select("+password");

    if (!user) {
      return res.status(401).json({
        success: false,
        error: "Invalid email or password"
      });
    }

    // Check password
    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: "Invalid email or password"
      });
    }

    // Create token
    const token = user.getSignedJwtToken();

    res.status(200).json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        stripeCustomerId: user.stripeCustomerId,
        subscription: user.subscription
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Server error"
    });
  }
};

// Get current user
exports.getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.status(200).json({
      success: true,
      user
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Server error"
    });
  }
};

// Create Stripe customer for user
exports.createStripeCustomer = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);

    if (user.stripeCustomerId) {
      return res.status(200).json({
        success: true,
        stripeCustomerId: user.stripeCustomerId
      });
    }

    // Create Stripe customer
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.name,
      metadata: {
        userId: user._id.toString()
      }
    });

    // Save to user
    user.stripeCustomerId = customer.id;
    await user.save();

    res.status(200).json({
      success: true,
      stripeCustomerId: customer.id
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to create Stripe customer"
    });
  }
};