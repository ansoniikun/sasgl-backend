import jwt from "jsonwebtoken";
import pool from "../db/index.js"; // Adjust this path as needed

// Middleware: Verify token and attach user
export const verifyToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1]; // "Bearer <token>"

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: "Invalid or expired token" });
  }
};

// Middleware: Check if user is a club captain
export const requireCaptain = async (req, res, next) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT * FROM users WHERE id = $1 AND role = 'captain'`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res
        .status(403)
        .json({ error: "Access denied: Not a club captain" });
    }

    // Optionally: pass the club_id(s) the captain is part of
    req.user.captainOf = result.rows.map((row) => row.club_id);

    next();
  } catch (error) {
    console.error("Error checking club captain:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};
