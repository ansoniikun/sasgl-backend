import express from "express";
import cors from "cors";
import authRoutes from "./routes/auth.js";
import userDashboard from "./routes/userDashboard.js";
import clubs from "./routes/clubs.js";
import adminRoutes from "./routes/admin.js";
import activeLeagues from "./routes/leagues.js";
import activeUsers from "./routes/users.js";
import eventsRoutes from "./routes/events.js";

const app = express();

// CORS configuration
const allowedOrigins = [
  "https://sasgl.co.za",
  "https://www.sasgl.co.za",
  "https://sasgl.vercel.app",
  "http://localhost:3000",
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true, // if you use cookies/auth headers
  })
);

app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/dashboard", userDashboard);
app.use("/api/clubs", clubs);
app.use("/api/admin", adminRoutes);
app.use("/api/leagues", activeLeagues);
app.use("/api/users", activeUsers);
app.use("/api/events", eventsRoutes);
app.get("/", (req, res) => res.send("SASGL API is running."));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
