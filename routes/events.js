import express from "express";
import pool from "../db/index.js";

const router = express.Router();

router.get("/club/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query("SELECT * FROM events WHERE club_id = $1", [
      id,
    ]);

    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Error fetching club events:", err);
    res.status(500).json({ error: "Failed to fetch events for this club" });
  }
});

export default router;
