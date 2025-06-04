import express from "express";
import { verifyToken } from "../middleware/auth.js";
import pool from "../db/index.js";

const router = express.Router();

// GET /dashboard/stats — fetch user's basic stats, club (if any), and ranking info
router.get("/stats", verifyToken, async (req, res) => {
  const userId = req.user.id;

  try {
    const userStats = await pool.query(
      `
      SELECT 
        u.name,
        u.email,
        u.role,
        cs.name AS club_name,
        COALESCE(us.total_points, 0) AS total_points,
        COALESCE(us.total_games, 0) AS events_played,
        (
          SELECT MAX(points)
          FROM event_user_stats
          WHERE user_id = $1
        ) AS best_score
      FROM users u
      LEFT JOIN user_stats us ON u.id = us.user_id
      LEFT JOIN club_members cm ON u.id = cm.user_id AND cm.status = 'approved'
      LEFT JOIN clubs cs ON cm.club_id = cs.id
      WHERE u.id = $1
      `,
      [userId]
    );

    if (userStats.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(userStats.rows[0]);
  } catch (err) {
    console.error("Error fetching stats:", err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

export default router;
