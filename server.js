require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const app = express();

// Middleware
// app.use(cors({
//   origin: ['chrome-extension://*', 'http://localhost:3000'],
//   credentials: true
// }));
app.use(cors())
app.use(express.json());

// Global variable to cache connection
let isMongoConnected = false;

// MongoDB connection function
async function connectDB() {
  // If already connected, return
  if (isMongoConnected && mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  try {
    // Connection options optimized for serverless
    const options = {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 10000, // 10 seconds timeout
      socketTimeoutMS: 45000, // 45 seconds
      maxPoolSize: 10,
      ssl: true,
      retryWrites: true,
      w: 'majority'
    };

    // Your MongoDB Atlas connection string
    const mongoUri = process.env.MONGODB_URI || "mongodb+srv://learnFirstAdmin:mT4aOUQ8IeZlGqf6@khareedofrokht.h4nje.mongodb.net/zillow?retryWrites=true&w=majority&appName=khareedofrokht";
    
    console.log("🔌 Connecting to MongoDB...");
    console.log("Connection string (safe):", mongoUri.replace(/:\/\/[^:]+:[^@]+@/, '://***:***@'));
    
    await mongoose.connect(mongoUri, options);
    
    isMongoConnected = true;
    console.log("✅ MongoDB connected successfully");
    
    // Handle connection events
    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err);
      isMongoConnected = false;
    });
    
    mongoose.connection.on('disconnected', () => {
      console.log('MongoDB disconnected');
      isMongoConnected = false;
    });
    
    return mongoose.connection;
    
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error.message);
    console.error("Error details:", error);
    isMongoConnected = false;
    throw error;
  }
}

// Alternative: Simplified connection function
async function connectDB2() {
  try {
    // Simple connection with minimal options
    const mongoUri = process.env.MONGODB_URI || "mongodb+srv://learnFirstAdmin:mT4aOUQ8IeZlGqf6@khareedofrokht.h4nje.mongodb.net/zillow?retryWrites=true&w=majority&appName=khareedofrokht";
    
    console.log("Connecting to MongoDB with simple options...");
    
    // Remove any existing connections
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    console.log("✅ MongoDB connected");
    return mongoose.connection;
    
  } catch (error) {
    console.error("Failed to connect:", error);
    throw error;
  }
}

// Test connection endpoint
app.get("/api/test-connection", async (req, res) => {
  try {
    const connection = await connectDB2();
    const collections = await connection.db.listCollections().toArray();
    
    res.json({
      success: true,
      message: "MongoDB connected successfully",
      database: connection.db.databaseName,
      collections: collections.map(c => c.name),
      readyState: connection.readyState
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      name: error.name
    });
  }
});

// Middleware to ensure DB connection for each request
app.use(async (req, res, next) => {
  // Skip for test endpoint
  if (req.path === '/api/test-connection') {
    return next();
  }
  
  try {
    await connectDB2();
    next();
  } catch (error) {
    console.error("Database connection failed in middleware:", error);
    res.status(503).json({ 
      success: false, 
      error: "Database service unavailable",
      message: error.message
    });
  }
});

// ===================== MODELS =====================

// User Schema
const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  stripeCustomerId: String,
  subscriptionActive: { type: Boolean, default: false },
  subscriptionId: String,
  createdAt: { type: Date, default: Date.now }
});

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (this.isModified('password')) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  next();
});

const User = mongoose.model('User', userSchema);

// ===================== ROUTES =====================

// Health check
app.get("/api/health", async (req, res) => {
  try {
    const db = mongoose.connection;
    // Simple ping to check connection
    await db.db.admin().command({ ping: 1 });
    
    res.json({
      status: "healthy",
      database: "connected",
      timestamp: new Date().toISOString(),
      mongoState: db.readyState,
      version: "1.0.0"
    });
  } catch (error) {
    res.status(500).json({
      status: "unhealthy",
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Register
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Validation
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        error: "Please provide all required fields"
      });
    }

    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: "User already exists"
      });
    }

    // Create Stripe customer
    let stripeCustomer;
    try {
      stripeCustomer = await stripe.customers.create({
        email,
        name
      });
      console.log("Stripe customer created:", stripeCustomer.id);
    } catch (stripeError) {
      console.error("Stripe customer creation failed:", stripeError);
      // Continue without Stripe for now
    }

    // Create user
    const user = new User({
      name,
      email,
      password,
      stripeCustomerId: stripeCustomer ? stripeCustomer.id : null
    });

    await user.save();
    console.log("User created:", user._id);

    // Create JWT token
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET || "your_jwt_secret",
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
    res.status(500).json({
      success: false,
      error: "Registration failed",
      details: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
});

// Login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: "Please provide email and password"
      });
    }

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({
        success: false,
        error: "Invalid credentials"
      });
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        error: "Invalid credentials"
      });
    }

    // Create token
    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET || "your_jwt_secret",
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
    res.status(500).json({
      success: false,
      error: "Login failed"
    });
  }
});

// Check subscription (protected)
app.get("/api/auth/check-subscription", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: "No token provided"
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "your_jwt_secret");
    
    // Find user
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: "User not found"
      });
    }

    // Check subscription
    if (user.subscriptionActive) {
      return res.json({
        success: true,
        hasSubscription: true,
        message: "User has active subscription"
      });
    }

    // If subscription ID exists, check with Stripe
    if (user.subscriptionId) {
      try {
        const subscription = await stripe.subscriptions.retrieve(user.subscriptionId);
        
        if (subscription.status === "active" || subscription.status === "trialing") {
          // Update user
          user.subscriptionActive = true;
          await user.save();
          
          return res.json({
            success: true,
            hasSubscription: true,
            message: "User has active subscription"
          });
        }
      } catch (stripeError) {
        console.error("Stripe subscription check failed:", stripeError);
      }
    }

    // No subscription found
    res.json({
      success: true,
      hasSubscription: false,
      message: "No active subscription found"
    });

  } catch (error) {
    console.error("Check subscription error:", error);
    
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        error: "Invalid token"
      });
    }
    
    res.status(500).json({
      success: false,
      error: "Failed to check subscription"
    });
  }
});

// Create subscription (protected)
app.post("/api/stripe/create-subscription", async (req, res) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: "No token provided"
      });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "your_jwt_secret");
    
    // Find user
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: "User not found"
      });
    }

    // Check if already has subscription
    if (user.subscriptionActive) {
      return res.status(400).json({
        success: false,
        error: "User already has active subscription"
      });
    }

    // Ensure user has Stripe customer ID
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name
      });
      customerId = customer.id;
      
      // Update user
      user.stripeCustomerId = customerId;
      await user.save();
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ["card"],
      line_items: [{
        price: process.env.STRIPE_PRICE_ID,
        quantity: 1
      }],
      mode: "subscription",
      success_url: `${req.headers.origin || "http://localhost:3000"}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin || "http://localhost:3000"}/cancel`,
      metadata: {
        userId: user._id.toString()
      }
    });

    res.json({
      success: true,
      url: session.url,
      sessionId: session.id
    });

  } catch (error) {
    console.error("Create subscription error:", error);
    
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        error: "Invalid token"
      });
    }
    
    res.status(500).json({
      success: false,
      error: "Failed to create subscription"
    });
  }
});

// Webhook handler
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error("Webhook error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case "checkout.session.completed":
      const session = event.data.object;
      const userId = session.metadata?.userId;
      
      if (userId) {
        try {
          await User.findByIdAndUpdate(userId, {
            subscriptionActive: true,
            subscriptionId: session.subscription
          });
          console.log(`Subscription activated for user: ${userId}`);
        } catch (updateError) {
          console.error("Failed to update user subscription:", updateError);
        }
      }
      break;
      
    case "customer.subscription.deleted":
      const subscription = event.data.object;
      
      try {
        await User.findOneAndUpdate(
          { stripeCustomerId: subscription.customer },
          { subscriptionActive: false }
        );
        console.log(`Subscription deactivated for customer: ${subscription.customer}`);
      } catch (updateError) {
        console.error("Failed to deactivate subscription:", updateError);
      }
      break;
  }

  res.json({ received: true });
});

// Test endpoint to create a user (for debugging)
app.post("/api/test/create-user", async (req, res) => {
  try {
    const { name, email } = req.body;
    
    const user = new User({
      name,
      email,
      password: "test123",
      stripeCustomerId: "test_customer_" + Date.now()
    });
    
    await user.save();
    
    res.json({
      success: true,
      userId: user._id,
      message: "Test user created"
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get all users (for debugging)
app.get("/api/test/users", async (req, res) => {
  try {
    const users = await User.find({});
    res.json({
      success: true,
      count: users.length,
      users: users.map(u => ({
        id: u._id,
        name: u.name,
        email: u.email,
        stripeCustomerId: u.stripeCustomerId,
        subscriptionActive: u.subscriptionActive
      }))
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    message: "BNB Flow API",
    status: "running",
    endpoints: {
      test: {
        connection: "GET /api/test-connection",
        createUser: "POST /api/test/create-user",
        getUsers: "GET /api/test/users"
      },
      auth: {
        register: "POST /api/auth/register",
        login: "POST /api/auth/login",
        checkSubscription: "GET /api/auth/check-subscription"
      },
      stripe: {
        createSubscription: "POST /api/stripe/create-subscription",
        webhook: "POST /api/stripe/webhook"
      },
      health: "GET /api/health"
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(500).json({
    success: false,
    error: "Internal server error"
  });
});

// For Vercel serverless
if (process.env.VERCEL) {
  module.exports = app;
} else {
  // Local development
  const PORT = process.env.PORT || 5000;
  
  // Connect to MongoDB on startup for local dev
  async function startServer() {
    try {
      await connectDB2();
      app.listen(PORT, () => {
        console.log(`✅ Server running on port ${PORT}`);
        console.log(`✅ MongoDB connected`);
        console.log(`✅ Local URL: http://localhost:${PORT}`);
        console.log(`✅ Health check: http://localhost:${PORT}/api/health`);
        console.log(`✅ Test connection: http://localhost:${PORT}/api/test-connection`);
      });
    } catch (error) {
      console.error("Failed to start server:", error);
      console.log("\nTroubleshooting tips:");
      console.log("1. Check if MongoDB Atlas cluster is active (not paused)");
      console.log("2. Check if IP 0.0.0.0/0 is whitelisted in MongoDB Atlas");
      console.log("3. Check your connection string");
      console.log("4. Try connecting with MongoDB Compass");
      process.exit(1);
    }
  }
  
  startServer();
}