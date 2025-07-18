const dotenv = require("dotenv");
dotenv.config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();
app.use(cors());
app.use(express.json());

mongoose
  .connect(process.env.REACT_APP_MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.error("MongoDB connection error:", err));

const flightSchema = new mongoose.Schema(
  {
    origin: String,
    destination: String,
    departureDate: String,
    data: Object,
  },
  { timestamps: true }
);

flightSchema.index(
  { origin: 1, destination: 1, departureDate: 1 },
  { unique: true }
);

const Flight = mongoose.model("Flight", flightSchema);

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

function getSameDayEachMonth(startDate) {
  const result = [];
  const base = new Date(startDate);
  const day = base.getDate();

  for (let i = 0; i < 11; i++) {
    const date = new Date(base);
    date.setMonth(base.getMonth() + i);
    const daysInMonth = new Date(
      date.getFullYear(),
      date.getMonth() + 1,
      0
    ).getDate();
    date.setDate(Math.min(day, daysInMonth));
    result.push(date.toISOString().split("T")[0]);
  }
  return result;
}

async function getAmadeusToken(account) {
  const client_id = process.env[`REACT_APP_AMADEUS_API_KEY_${account}`];
  const client_secret = process.env[`REACT_APP_AMADEUS_API_SECRET_${account}`];

  const params = new URLSearchParams();
  params.append("grant_type", "client_credentials");
  params.append("client_id", client_id);
  params.append("client_secret", client_secret);

  const response = await axios.post(
    `${process.env.REACT_APP_AMADEUS_API_AUTH_URL}v1/security/oauth2/token`,
    params,
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );

  return response.data.access_token;
}

async function fetchFlightsIfNotInDB(
  origin,
  destination,
  adults,
  dates,
  token,
  accountNo
) {
  const results = [];
  const errors = [];

  for (const date of dates) {
    try {
      const existing = await Flight.findOne({
        origin,
        destination,
        departureDate: date,
      });

      if (existing) {
        results.push({ source: "db", ...existing._doc });
        continue;
      }

      const response = await axios.get(
        `${process.env.REACT_APP_AMADEUS_API_AUTH_URL}v2/shopping/flight-offers`,
        {
          headers: { Authorization: `Bearer ${token}` },
          params: {
            originLocationCode: origin,
            destinationLocationCode: destination,
            departureDate: date,
            adults,
          },
        }
      );

      const offers = response.data?.data;
      if (!offers || offers.length === 0) {
        errors.push({ date, error: "No offers found" });
        continue;
      }

      const cheapest = offers.reduce((min, curr) =>
        parseFloat(curr.price.total) < parseFloat(min.price.total) ? curr : min
      );

      const upserted = await Flight.findOneAndUpdate(
        { origin, destination, departureDate: date },
        { origin, destination, departureDate: date, data: cheapest },
        { upsert: true, new: true }
      );

      results.push({ source: "api", ...upserted._doc });
    } catch (err) {

      if (err.code === 11000) {
        const doc = await Flight.findOne({
          origin,
          destination,
          departureDate: date,
        });
        results.push({ source: "db", ...doc._doc });
      } else {
        errors.push({
          date,
          error: err?.response?.data?.message || err.message,
          account: accountNo,
        });
      }
    }

    await delay(500);
  }

  return { results, errors };
}

app.post("/api/fetch-flights", async (req, res) => {
  const { origin, destination, selectedDate, adults } = req.body;

  if (!origin || !destination || !selectedDate) {
    return res.status(400).json({
      error: "origin, destination, and selectedDate are required",
    });
  }

  try {
    const dates = getSameDayEachMonth(selectedDate);
    const [token1] = await Promise.all([getAmadeusToken(1)]);
    const [res1] = await Promise.all([
      fetchFlightsIfNotInDB(origin, destination, adults, dates, token1, 1),
    ]);

    const flights = [...res1.results].sort(
      (a, b) => new Date(a.departureDate) - new Date(b.departureDate)
    );

    const errors = [...res1.errors];

    res.json({ total: flights.length, flights, errors });
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/", (req, res) => {
  res.send("Amadeus API is running.");
});

app.listen(process.env.NODE_SERVER_PORT, () => {
  console.log("Server running on port", process.env.NODE_SERVER_PORT);
});
