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

// Allowed origins for CORS
const allowedOrigins = [
  "https://sasgl.co.za",
  "https://www.sasgl.co.za",
  "https://sasgl.vercel.app",
  "http://localhost:3000",
];

// Middleware to handle CORS preflight and allow specific origins
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
};

// Trust proxy if using sessions/cookies behind reverse proxy (Render, Vercel, etc.)
app.set("trust proxy", 1);

// Apply CORS middleware
app.use(cors(corsOptions));

// Handle preflight OPTIONS requests
// Middleware to manually handle preflight requests safely
app.use((req, res, next) => {
  if (req.method === "OPTIONS") {
    res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
    res.header(
      "Access-Control-Allow-Methods",
      "GET,PUT,POST,DELETE,PATCH,OPTIONS"
    );
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.header("Access-Control-Allow-Credentials", "true");
    return res.sendStatus(200);
  }
  next();
});

// Body parser
app.use(express.json());

// Route definitions
app.use("/api/auth", authRoutes);
app.use("/api/dashboard", userDashboard);
app.use("/api/clubs", clubs);
app.use("/api/admin", adminRoutes);
app.use("/api/leagues", activeLeagues);
app.use("/api/users", activeUsers);
app.use("/api/events", eventsRoutes);

// Root route
app.get("/", (req, res) => res.send("SASGL API is running."));

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
