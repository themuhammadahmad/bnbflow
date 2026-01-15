const House = require("../models/House");
const axios = require("axios");
const ApiUsage = require("../models/ApiUsage");
const AIRDNA_API_KEY = process.env.AIRDNA_API_KEY;

// async function fetchFromAirDNA(address, bedrooms, bathrooms, accommodates) {
//     try {
//         const url = "https://api.airdna.co/api/enterprise/v2/rentalizer/summary/individual";
//         let reqData = {
//             address,
//             bedrooms,
//             bathrooms,
//             currency: "usd",
//         };
//         if (accommodates) {
//             reqData.accommodates = accommodates;
//         }
        
//         const { data } = await axios.post(url, reqData, {
//             headers: {
//                 "Content-Type": "application/json",
//                 Authorization: `Bearer ${AIRDNA_API_KEY}`,
//             },
//         });

//         // Check for AirDNA specific error
//         if (data?.status?.type === 'error') {
//             if (data.status.response_id === 'API-E-063') {
//                 throw new Error("NO_COMP_DATA");
//             }
//             throw new Error(data.status.message || "AirDNA API error");
//         }

//         if (!data?.payload) {
//             throw new Error("Invalid response from AirDNA");
//         }

//         const details = data.payload.details;
//         const stats = data.payload.stats.future.summary;

//         return {
//             address: details.address,
//             zipcode: details.zipcode,
//             accommodates: details.accommodates,
//             bedrooms: details.bedrooms,
//             bathrooms: details.bathrooms,
//             adr: stats.adr,
//             revenue: stats.revenue,
//             occupancy: stats.occupancy,
//         };
//     } catch (err) {
//         console.error("AirDNA API error:", err.response?.data || err.message);
        
//         // Re-throw the specific NO_COMP_DATA error
//         if (err.message === "NO_COMP_DATA") {
//             throw err;
//         }
        
//         // Handle axios errors
//         if (err.response?.data?.status?.response_id === 'API-E-063') {
//             throw new Error("NO_COMP_DATA");
//         }
        
//         throw new Error("Failed to fetch data from AirDNA");
//     }
// }
// Helper function for AirDNA API (copied from your controller)
async function fetchFromAirDNA(address, bedrooms, bathrooms, accommodates) {
  try {
    const url = "https://api.airdna.co/api/enterprise/v2/rentalizer/summary/individual";
    let reqData = {
      address,
      bedrooms,
      bathrooms,
      currency: "usd",
    };
    
    if (accommodates) {
      reqData.accommodates = accommodates;
    }
    
    const { data } = await axios.post(url, reqData, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.AIRDNA_API_KEY}`,
      },
    });

    if (data?.status?.type === 'error') {
      if (data.status.response_id === 'API-E-063') {
        throw new Error("NO_COMP_DATA");
      }
      throw new Error(data.status.message || "AirDNA API error");
    }

    if (!data?.payload) {
      throw new Error("Invalid response from AirDNA");
    }

    const details = data.payload.details;
    const stats = data.payload.stats.future.summary;

    return {
      address: details.address,
      zipcode: details.zipcode,
      accommodates: details.accommodates,
      bedrooms: details.bedrooms,
      bathrooms: details.bathrooms,
      adr: stats.adr,
      revenue: stats.revenue,
      occupancy: stats.occupancy,
    };
  } catch (err) {
    console.error("AirDNA API error:", err.response?.data || err.message);
    
    if (err.message === "NO_COMP_DATA") {
      throw err;
    }
    
    if (err.response?.data?.status?.response_id === 'API-E-063') {
      throw new Error("NO_COMP_DATA");
    }
    
    throw new Error("Failed to fetch data from AirDNA");
  }
}

exports.getHouseData = async (req, res) => {
    try {
      // Your existing house data logic from housecontroller.js
      const { address, bedrooms, bathrooms, accommodates } = req.body;

      if (!address) {
        return res.status(400).json({ 
          success: false,
          error: "Address is required" 
        });
      }

      // Check if house already exists
      let house = await House.findOne({ address });

      if (house) {
        return res.json({
          success: true,
          data: house,
          fromCache: true
        });
      }

      // Fetch from AirDNA
      const airdnaData = await fetchFromAirDNA(address, bedrooms, bathrooms, accommodates);

      // Save to DB
      house = new House({
        address: airdnaData.address,
        bedrooms: airdnaData.bedrooms,
        bathrooms: airdnaData.bathrooms,
        accommodates: airdnaData.accommodates,
        adr: airdnaData.adr,
        revenue: airdnaData.revenue,
        occupancy: airdnaData.occupancy,
      });

      await house.save();

      // Track AirDNA API usage globally (optional - if you want to track total AirDNA calls)
      const currentMonth = new Date().toISOString().slice(0, 7);
      await ApiUsage.findOneAndUpdate(
        { provider: "AirDNA", month: currentMonth },
        { $inc: { count: 1 }, $set: { lastUpdated: new Date() } },
        { upsert: true, new: true }
      );

      res.json({
        success: true,
        data: house,
        fromCache: false
      });

    } catch (error) {
      console.error("Error fetching house:", error.message);
      
      if (error.message === "NO_COMP_DATA") {
        return res.status(404).json({ 
          success: false,
          error: "No comparable data available",
          message: "Sorry, we don't have rental data available for this address."
        });
      }
      
      res.status(500).json({ 
        success: false,
        error: "Server error" 
      });
    }
};