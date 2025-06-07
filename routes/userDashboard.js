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

// PUT /users/edit — update user profile
router.put("/edit", verifyToken, async (req, res) => {
  const userId = req.user.id;
  const { name, email, password, phone_number } = req.body;

  try {
    let updateFields = [];
    let values = [];
    let index = 1;

    if (name) {
      updateFields.push(`name = $${index++}`);
      values.push(name);
    }
    if (email) {
      updateFields.push(`email = $${index++}`);
      values.push(email);
    }
    if (phone_number) {
      updateFields.push(`phone_number = $${index++}`);
      values.push(phone_number);
    }
    if (password) {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      updateFields.push(`password_hash = $${index++}`);
      values.push(hashedPassword);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    values.push(userId);
    const query = `
      UPDATE users
      SET ${updateFields.join(", ")}, updated_at = NOW()
      WHERE id = $${index}
      RETURNING id, name, email, phone_number, role, created_at, updated_at
    `;

    const result = await pool.query(query, values);
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error updating user profile:", err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

export default router;
