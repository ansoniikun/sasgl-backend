import express from "express";
import pool from "../db/index.js";
import { verifyToken } from "../middleware/auth.js";

const router = express.Router();

// GET /api/users/me
router.get("/me", verifyToken, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      "SELECT id, name, email, role, phone_number FROM users WHERE id = $1",
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Failed to fetch user:", err);
    res.status(500).json({ error: "Failed to fetch user info" });
  }
});

export default router;
