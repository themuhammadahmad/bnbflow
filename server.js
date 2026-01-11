require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const connectDB = require("./config/db");


const app = express();

// Check if running on Vercel
const isVercel = process.env.VERCEL === "1";



// Enhanced CORS for Chrome extension and Vercel
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin && isVercel) return callback(null, true);
    
    // Allow Chrome extension origins
    if (origin && origin.startsWith('chrome-extension://')) {
      return callback(null, true);
    }
    
    // Allow localhost for development
    if (origin && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
      return callback(null, true);
    }
    
    // Allow your Vercel frontend if you have one
    if (origin && origin.includes('.vercel.app')) {
      return callback(null, true);
    }
    
    // For production, you might want to restrict this
    if (isVercel) {
      return callback(null, true); // Allow all on Vercel for now
    }
    
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

// Increase timeout for serverless
app.use((req, res, next) => {
  req.setTimeout(30000, () => {
    console.log('Request timeout');
  });
  res.setTimeout(30000);
  next();
});


// Middleware
app.use(express.json());
// Health check (important for serverless)
app.get("/api/health", async (req, res) => {
  try {
    // Try to connect to DB
    await connectDB();
    
    res.json({ 
      status: "healthy",
      environment: isVercel ? "vercel" : "local",
      timestamp: new Date().toISOString(),
      database: "connected"
    });
  } catch (error) {
    res.status(500).json({
      status: "unhealthy",
      environment: isVercel ? "vercel" : "local",
      timestamp: new Date().toISOString(),
      database: "disconnected",
      error: error.message
    });
  }
});

// Connect to DB before auth routes (but don't block startup)
app.use(async (req, res, next) => {
  // For health check, skip DB connection
  if (req.path === '/api/health') return next();
  
  try {
    await connectDB();
    next();
  } catch (error) {
    console.error('Database connection failed:', error.message);
    res.status(503).json({
      success: false,
      error: "Database service unavailable",
      details: isVercel ? "Vercel serverless issue - check MongoDB Atlas" : "Local DB issue"
    });
  }
});

// Routes
app.get("/", (req, res) => {
  res.json({
    message: "BNB Flow API",
    status: "running",
    environment: isVercel ? "production" : "development",
    endpoints: {
      auth: {
        register: "POST /api/auth/register",
        login: "POST /api/auth/login",
        checkSubscription: "GET /api/auth/check-subscription"
      },
      stripe: {
        createSubscription: "POST /api/stripe/create-subscription"
      }
    }
  });
});

// Test MongoDB connection
app.get("/api/test-mongo", async (req, res) => {
  try {
    const db = await connectDB();
    
    // Test with a simple query
    const User = require("./models/User");
    const userCount = await User.countDocuments();
    
    res.json({
      success: true,
      message: "MongoDB connection successful",
      userCount,
      connectionState: db.readyState,
      readyState: {
        0: 'disconnected',
        1: 'connected',
        2: 'connecting',
        3: 'disconnecting'
      }[db.readyState]
    });
  } catch (error) {
    console.error('MongoDB test failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      name: error.name,
      code: error.code
    });
  }
});
// Import User model
const User = require("./models/User");

// Auth middleware
const auth = async (req, res, next) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");
    if (!token) throw new Error();
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    
    if (!user) throw new Error();
    
    req.user = user;
    req.token = token;
    next();
  } catch (err) {
    res.status(401).json({ error: "Please authenticate" });
  }
};

// ===================== AUTH ROUTES =====================


app.get("/", (req, res) => {
   res.send("asdf")
})
// Register
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: "User already exists" });
    }

    // Create user
    const user = new User({ name, email, password });
    
    // Create Stripe customer
    const stripeCustomer = await stripe.customers.create({
      email,
      name,
      metadata: { userId: user._id.toString() }
    });
    
    // Save Stripe customer ID
    user.stripeCustomerId = stripeCustomer.id;
    await user.save();

    // Create JWT token
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(201).json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        stripeCustomerId: user.stripeCustomerId,
        subscriptionActive: user.subscriptionActive
      }
    });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({ error: "Registration failed" });
  }
});

// Login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Create token
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        stripeCustomerId: user.stripeCustomerId,
        subscriptionActive: user.subscriptionActive
      }
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
});

// Check subscription status (protected)
app.get("/api/auth/check-subscription", auth, async (req, res) => {
  try {
    // If user already has active subscription in our DB
    if (req.user.subscriptionActive) {
      return res.json({ 
        hasSubscription: true,
        message: "User has active subscription"
      });
    }

    // Check with Stripe if subscription exists
    if (req.user.subscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(req.user.subscriptionId);
      
      if (subscription.status === "active" || subscription.status === "trialing") {
        // Update our DB
        req.user.subscriptionActive = true;
        await req.user.save();
        
        return res.json({ 
          hasSubscription: true,
          message: "User has active subscription"
        });
      }
    }

    // No subscription
    res.json({ 
      hasSubscription: false,
      message: "No active subscription found"
    });
  } catch (error) {
    console.error("Check subscription error:", error);
    res.status(500).json({ error: "Failed to check subscription" });
  }
});

// ===================== STRIPE ROUTES =====================

// Create subscription checkout
app.post("/api/stripe/create-subscription", auth, async (req, res) => {
  try {
    const user = req.user;
    
    // Check if user already has active subscription
    if (user.subscriptionActive) {
      return res.status(400).json({ error: "User already has active subscription" });
    }

    // Ensure user has Stripe customer ID
    if (!user.stripeCustomerId) {
      const stripeCustomer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId: user._id.toString() }
      });
      user.stripeCustomerId = stripeCustomer.id;
      await user.save();
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: user.stripeCustomerId,
      payment_method_types: ["card"],
      line_items: [
        {
          price: process.env.STRIPE_PRICE_ID,
          quantity: 1
        }
      ],
      mode: "subscription",
      success_url: `${req.headers.origin || "http://localhost:3000"}/tabs/index.html`,
      cancel_url: `${req.headers.origin || "http://localhost:3000"}/tabs/index.html`,
      
      metadata: {
        userId: user._id.toString()
      }
    });

    res.json({
      url: session.url,
      sessionId: session.id
    });
  } catch (error) {
    console.error("Create subscription error:", error);
    res.status(500).json({ error: "Failed to create subscription" });
  }
});

// Webhook to handle subscription events
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      "whsec_your_webhook_secret" // You should use env variable in production
    );
  } catch (err) {
    console.error("Webhook error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle checkout.session.completed event
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    
    try {
      const user = await User.findOne({ 
        stripeCustomerId: session.customer 
      });

      if (user) {
        // Get subscription details
        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        
        // Update user subscription status
        user.subscriptionId = subscription.id;
        user.subscriptionActive = true;
        await user.save();
        
        console.log(`Subscription activated for user: ${user.email}`);
      }
    } catch (error) {
      console.error("Webhook user update error:", error);
    }
  }

  // Handle subscription canceled or failed
  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object;
    
    try {
      const user = await User.findOne({ 
        stripeCustomerId: subscription.customer 
      });

      if (user) {
        user.subscriptionActive = false;
        await user.save();
        
        console.log(`Subscription deactivated for user: ${user.email}`);
      }
    } catch (error) {
      console.error("Webhook subscription delete error:", error);
    }
  }

  res.json({ received: true });
});

// Test route
app.get("/", (req, res) => {
  res.send(`
    <h1>Simple Stripe Subscription API</h1>
    <p>Endpoints:</p>
    <ul>
      <li>POST /api/auth/register - Register user</li>
      <li>POST /api/auth/login - Login user</li>
      <li>GET /api/auth/check-subscription - Check subscription status (protected)</li>
      <li>POST /api/stripe/create-subscription - Create subscription checkout (protected)</li>
    </ul>
  `);
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    error: "Internal server error",
    message: isVercel ? "Serverless function error" : "Local server error"
  });
});


// Export for Vercel serverless
if (isVercel) {
  module.exports = app;
} else {
  // Local development
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📡 MongoDB URI: ${process.env.MONGODB_URI ? 'Set' : 'Not set'}`);
  });
}

// const PORT = process.env.PORT || 5000;
// app.listen(PORT, () => {
//   console.log(`✅ Server running on port ${PORT}`);
//   console.log(`✅ Stripe Price ID: ${process.env.STRIPE_PRICE_ID}`);
// });