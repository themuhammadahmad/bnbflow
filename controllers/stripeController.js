const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const User = require("../models/User");
const Payment = require("../models/Payment");

// Create payment intent
exports.createPaymentIntent = async (req, res) => {
  try {
    const { amount, currency = "usd" } = req.body;
    const user = req.user;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Amount is required" });
    }

    // Ensure Stripe customer exists
    if (!user.stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId: user._id.toString() }
      });
      user.stripeCustomerId = customer.id;
      await user.save();
    }

    // Create payment intent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency,
      customer: user.stripeCustomerId,
      metadata: {
        userId: user._id.toString(),
        userEmail: user.email
      }
    });

    // Save payment record
    await Payment.create({
      userId: user._id,
      stripeCustomerId: user.stripeCustomerId,
      paymentIntentId: paymentIntent.id,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      status: paymentIntent.status
    });

    res.status(200).json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: error.message });
  }
};

// Get payment status
exports.getPaymentStatus = async (req, res) => {
  try {
    const { paymentIntentId } = req.params;
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    // Update local record
    await Payment.findOneAndUpdate(
      { paymentIntentId },
      { status: paymentIntent.status }
    );

    res.status(200).json({
      status: paymentIntent.status,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Create checkout session
exports.createCheckout = async (req, res) => {
  try {
    const { priceId, successUrl, cancelUrl } = req.body;
    const user = req.user;

    if (!user.stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId: user._id.toString() }
      });
      user.stripeCustomerId = customer.id;
      await user.save();
    }

    const session = await stripe.checkout.sessions.create({
      customer: user.stripeCustomerId,
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity: 1
        }
      ],
      mode: "subscription",
      success_url: successUrl || `${process.env.CLIENT_URL}/success`,
      cancel_url: cancelUrl || `${process.env.CLIENT_URL}/cancel`,
      metadata: {
        userId: user._id.toString()
      }
    });

    res.status(200).json({
      url: session.url,
      sessionId: session.id
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get products/prices
exports.getProducts = async (req, res) => {
  try {
    const products = await stripe.products.list({ active: true });
    const prices = await stripe.prices.list({ active: true });

    const productsWithPrices = products.data.map(product => {
      const productPrices = prices.data.filter(price => price.product === product.id);
      return {
        id: product.id,
        name: product.name,
        description: product.description,
        prices: productPrices.map(price => ({
          id: price.id,
          amount: price.unit_amount / 100,
          currency: price.currency,
          interval: price.recurring?.interval
        }))
      };
    });

    res.status(200).json(productsWithPrices);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Webhook handler
exports.webhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle events
  switch (event.type) {
    case "payment_intent.succeeded":
      const paymentIntent = event.data.object;
      await Payment.findOneAndUpdate(
        { paymentIntentId: paymentIntent.id },
        { status: "succeeded" }
      );
      break;

    case "customer.subscription.created":
    case "customer.subscription.updated":
      const subscription = event.data.object;
      const userId = subscription.metadata.userId;
      
      if (userId) {
        await User.findByIdAndUpdate(userId, {
          subscription: {
            status: subscription.status,
            subscriptionId: subscription.id,
            plan: subscription.items.data[0]?.price.id
          }
        });
      }
      break;

    case "customer.subscription.deleted":
      const deletedSub = event.data.object;
      const userToUpdate = await User.findOne({ 
        stripeCustomerId: deletedSub.customer 
      });
      
      if (userToUpdate) {
        userToUpdate.subscription = {
          status: "none",
          subscriptionId: null,
          plan: null
        };
        await userToUpdate.save();
      }
      break;
  }

  res.json({ received: true });
};