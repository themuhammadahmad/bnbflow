const jwt = require("jsonwebtoken")
const User = require("../models/User")
// Middleware to check subscription and track API usage
const checkSubscriptionAndTrackUsage = async (req, res, next) => {
  try {
    // Get token from header
    const token = req.headers.authorization?.replace("Bearer ", "");
    
    if (!token) {
      return res.status(401).json({
        success: false,
        error: "Authentication required"
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

    // Check subscription status
    if (!user.subscriptionActive) {
      // If subscription ID exists, check with Stripe
      if (user.subscriptionId) {
        try {
          const subscription = await stripe.subscriptions.retrieve(user.subscriptionId);
          
          if (subscription.status === "active" || subscription.status === "trialing") {
            // Update user subscription status
            user.subscriptionActive = true;
            await user.save();
          } else {
            return res.status(403).json({
              success: false,
              error: "Subscription required",
              message: "Please subscribe to access house data"
            });
          }
        } catch (stripeError) {
          console.error("Stripe subscription check failed:", stripeError);
          return res.status(403).json({
            success: false,
            error: "Subscription required"
          });
        }
      } else {
        return res.status(403).json({
          success: false,
          error: "Subscription required",
          message: "Please subscribe to access house data"
        });
      }
    }

    // Check if user has reached monthly limit
    const currentMonth = new Date().toISOString().slice(0, 7);
    
    // Reset monthly counter if it's a new month
    if (user.apiUsage.currentMonth !== currentMonth) {
      user.apiUsage.monthlyRequests = 0;
      user.apiUsage.currentMonth = currentMonth;
    }

    // Check monthly limit
    if (user.apiUsage.monthlyRequests >= user.monthlyLimit) {
      return res.status(429).json({
        success: false,
        error: "Monthly limit exceeded",
        message: `You have exceeded your monthly limit of ${user.monthlyLimit} requests`,
        limit: user.monthlyLimit,
        used: user.apiUsage.monthlyRequests
      });
    }

    // Attach user to request for use in routes
    req.user = user;
    next();
    
  } catch (error) {
    console.error("Subscription/usage check error:", error);
    
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        error: "Invalid token"
      });
    }
    
    res.status(500).json({
      success: false,
      error: "Server error during authentication"
    });
  }
};

// Middleware to track API usage after successful response
const trackApiUsage = async (req, res, next) => {
  const originalJson = res.json;
  
  res.json = async function(data) {
    // Only track if request was successful
    if (res.statusCode >= 200 && res.statusCode < 300) {
      try {
        if (req.user && req.user._id) {
          const user = await User.findById(req.user._id);
          
          if (user) {
            const currentMonth = new Date().toISOString().slice(0, 7);
            
            // Initialize if not set
            if (!user.apiUsage) {
              user.apiUsage = {
                monthlyRequests: 0,
                currentMonth: currentMonth,
                totalRequests: 0
              };
            }
            
            // Reset if new month
            if (user.apiUsage.currentMonth !== currentMonth) {
              user.apiUsage.monthlyRequests = 0;
              user.apiUsage.currentMonth = currentMonth;
            }
            
            // Update usage counters
            user.apiUsage.monthlyRequests += 1;
            user.apiUsage.totalRequests += 1;
            user.apiUsage.lastRequestDate = new Date();
            
            await user.save();
          }
        }
      } catch (error) {
        console.error("Error tracking API usage:", error);
        // Don't fail the request if tracking fails
      }
    }
    
    return originalJson.call(this, data);
  };
  
  next();
};

module.exports = {checkSubscriptionAndTrackUsage, trackApiUsage}