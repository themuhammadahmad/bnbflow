const mongoose = require("mongoose");
let localStr = "mongodb://localhost:27017"
let str =  process.env.MONGODB_URI || "mongodb+srv://learnFirstAdmin:mT4aOUQ8IeZlGqf6@khareedofrokht.h4nje.mongodb.net/zillow?retryWrites=true&w=majority&appName=khareedofrokht";
const connectDB = async () => {
  try {
    await mongoose.connect(str);
    console.log("MongoDB connected");
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
};

module.exports = connectDB;