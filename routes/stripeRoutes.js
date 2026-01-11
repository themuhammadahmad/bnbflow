const express = require("express");
const router = express.Router();
const {
  createPaymentIntent,
  getPaymentStatus,
  createCheckout,
  getProducts,
  webhook
} = require("../controllers/stripeController");
const { protect } = require("../middleware/auth");

// Public
router.get("/products", getProducts);
router.get("/payment-status/:paymentIntentId", getPaymentStatus);

// Protected
router.post("/create-payment-intent", protect, createPaymentIntent);
router.post("/create-checkout", protect, createCheckout);

// Webhook (needs raw body)
router.post("/webhook", express.raw({ type: "application/json" }), webhook);

module.exports = router;