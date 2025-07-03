import express from "express";
import pool from "../db/index.js";
import { verifyToken } from "../middleware/auth.js";

const router = express.Router();

router.get("/active-leagues", verifyToken, async (req, res) => {
  const userId = req.user?.id;

  try {
    const result = await pool.query(`
      SELECT 
        events.*,
        clubs.logo_url,
        CASE
          WHEN CURRENT_DATE < events.start_date THEN 'upcoming'
          WHEN events.end_date IS NULL AND CURRENT_DATE >= events.start_date THEN 'active'
          WHEN CURRENT_DATE BETWEEN events.start_date AND events.end_date THEN 'active'
          ELSE 'completed'
        END AS status
      FROM events
      JOIN clubs ON events.club_id = clubs.id
      JOIN club_members ON club_members.club_id = clubs.id
      WHERE events.type = 'league'
        AND club_members.user_id = $1
      ORDER BY events.start_date ASC
    `, [userId]);

    res.set("Cache-Control", "no-store");
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching active leagues:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Fetch league details and leaderboard
router.get("/:id", async (req, res) => {
  const leagueId = req.params.id;

  try {
    // Fetch league event details (type = 'league')
    const leagueQuery = await pool.query(
      "SELECT * FROM events WHERE id = $1 AND type = 'league'",
      [leagueId]
    );

    if (leagueQuery.rowCount === 0) {
      return res.status(404).json({ error: "League not found" });
    }

    // Fetch leaderboard from pre-aggregated event_user_stats
    const leaderboardQuery = await pool.query(
      `
      SELECT 
        eus.user_id,
        u.name,
        eus.games_played,
        eus.points,
        eus.birdies,
        eus.avg_points
      FROM event_user_stats eus
      JOIN users u ON eus.user_id = u.id
      WHERE eus.event_id = $1
      ORDER BY eus.points DESC
    `,
      [leagueId]
    );

    res.json({
      league: leagueQuery.rows[0],
      leaderboard: leaderboardQuery.rows,
    });
  } catch (err) {
    console.error("Error fetching league details:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Register logged-in user for a league
router.post("/:id/register", async (req, res) => {
  const leagueId = req.params.id;
  const userId = req.user?.id; // Requires auth middleware to populate req.user

  if (!userId) {
    return res.status(401).json({ error: "Unauthorized: Please log in" });
  }

  try {
    // Ensure the league exists and is upcoming
    const leagueCheck = await pool.query(
      `SELECT * FROM events WHERE id = $1 AND type = 'league' AND start_date > CURRENT_DATE`,
      [leagueId]
    );

    if (leagueCheck.rowCount === 0) {
      return res
        .status(400)
        .json({ error: "League not found or not upcoming" });
    }

    // Prevent duplicate registration
    const existing = await pool.query(
      `SELECT * FROM event_participants WHERE event_id = $1 AND user_id = $2`,
      [leagueId, userId]
    );

    if (existing.rowCount > 0) {
      return res
        .status(400)
        .json({ error: "Already registered for this league" });
    }

    // Register user
    await pool.query(
      `INSERT INTO event_participants (event_id, user_id) VALUES ($1, $2)`,
      [leagueId, userId]
    );

    res.status(201).json({ message: "Successfully registered" });
  } catch (err) {
    console.error("Error registering user:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:id/authorized", verifyToken, async (req, res) => {
  const userId = req.user?.id;
  const leagueId = req.params.id;

  try {
    // Get club_id for this league (assuming you meant to get it from the events table)
    const leagueResult = await pool.query(
      "SELECT club_id FROM events WHERE id = $1",
      [leagueId]
    );

    if (leagueResult.rowCount === 0) {
      return res.status(404).json({ error: "League not found" });
    }

    const clubId = leagueResult.rows[0].club_id;

    const membershipResult = await pool.query(
      "SELECT 1 FROM club_members WHERE club_id = $1 AND user_id = $2",
      [clubId, userId]
    );

    const authorized = membershipResult.rowCount > 0;
    res.json({ authorized });
  } catch (err) {
    console.error("Error checking authorization", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
