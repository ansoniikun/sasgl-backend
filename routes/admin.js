// /routes/admin.js

import express from "express";
import db from "../db/index.js";
import { verifyToken } from "../middleware/auth.js";

const router = express.Router();

// Middleware to check if user is admin
const requireAdmin = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const result = await db.query("SELECT * FROM users WHERE id = $1", [
      userId,
    ]);
    const user = result.rows[0];

    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Access denied" });
    }

    req.user = user; // Attach full user to request
    next();
  } catch (error) {
    console.error("Admin check error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// ✅ GET authenticated user info
router.get("/me", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await db.query("SELECT * FROM users WHERE id = $1", [
      userId,
    ]);
    const user = result.rows[0];

    if (!user) return res.status(404).json({ error: "User not found" });
    res.json(user);
  } catch (error) {
    console.error("Error in /me route:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ✅ GET all admin data
router.get("/data", verifyToken, requireAdmin, async (req, res) => {
  try {
    const [
      users,
      userStats,
      clubs,
      clubStats,
      clubMembers,
      events,
      eventParticipants,
      logs,
    ] = await Promise.all([
      db.query("SELECT * FROM users"),
      db.query("SELECT * FROM user_stats"),
      db.query("SELECT * FROM clubs"),
      db.query("SELECT * FROM club_stats"),
      db.query("SELECT * FROM club_members"),
      db.query(`
  SELECT 
    *, 
    CASE
      WHEN CURRENT_DATE < start_date THEN 'upcoming'
      WHEN CURRENT_DATE BETWEEN start_date AND end_date THEN 'active'
      ELSE 'completed'
    END AS status
  FROM events
  ORDER BY start_date DESC
`),
      db.query("SELECT * FROM event_participants"),
      db.query("SELECT * FROM logs"),
    ]);

    res.json({
      users: users.rows,
      userStats: userStats.rows,
      clubs: clubs.rows,
      clubStats: clubStats.rows,
      clubMembers: clubMembers.rows,
      events: events.rows,
      eventParticipants: eventParticipants.rows,
      logs: logs.rows,
    });
  } catch (error) {
    console.error("Admin panel fetch error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ✅ GET all events (Admin)
router.get("/events", verifyToken, requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
  SELECT 
    *, 
    CASE
      WHEN CURRENT_DATE < start_date THEN 'upcoming'
      WHEN CURRENT_DATE BETWEEN start_date AND end_date THEN 'active'
      ELSE 'completed'
    END AS status
  FROM events
  ORDER BY start_date DESC
`);

    res.json({ events: result.rows });
  } catch (error) {
    console.error("Error fetching events:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ✅ POST /admin/events – Create Event with optional club_id + auto-add club members to event_participants
router.post("/events", verifyToken, requireAdmin, async (req, res) => {
  const {
    name,
    type,
    description,
    start_date,
    end_date,
    handicap,
    location,
    club_id,
  } = req.body;

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    // Step 1: Create the event
    const eventResult = await client.query(
      `INSERT INTO events 
        (name, type, description, start_date, end_date, handicap, location, club_id, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW()) 
       RETURNING *`,
      [
        name,
        type,
        description,
        start_date,
        end_date,
        handicap === true,
        location,
        club_id || null,
        req.user.id,
      ]
    );

    const event = eventResult.rows[0];

    // Step 2: If club_id is present, add approved club members to event_participants
    if (club_id) {
      const membersResult = await client.query(
        `SELECT user_id FROM club_members WHERE club_id = $1 AND status = 'approved'`,
        [club_id]
      );

      const members = membersResult.rows;

      for (const member of members) {
        await client.query(
          `INSERT INTO event_participants 
            (event_id, user_id, club_id)
           VALUES ($1, $2, $3)`,
          [event.id, member.user_id, club_id]
        );
      }
    }

    await client.query("COMMIT");
    res.status(201).json(event);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Event creation error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
});

// ✅ DELETE /admin/events/:id – Delete Event
router.delete("/events/:id", verifyToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    await db.query("DELETE FROM events WHERE id = $1", [id]);
    res.status(200).json({ message: "Event deleted" });
  } catch (error) {
    console.error("Event delete error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// ✅ PUT /admin/events/:id – Edit Event
router.put("/events/:id", verifyToken, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const {
    name,
    type,
    description,
    start_date,
    end_date,
    status,
    handicap,
    location,
  } = req.body;
  try {
    const result = await db.query(
      `UPDATE events SET 
     name = $1, 
     type = $2, 
     description = $3, 
     start_date = $4, 
     end_date = $5, 
     handicap = $6,
     location = $7,
     updated_at = NOW()
   WHERE id = $8 RETURNING *`,
      [
        name,
        type,
        description,
        start_date,
        end_date,
        handicap === true,
        location,
        id,
      ]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Event update error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// GET participants for a specific event
router.get(
  "/events/:event_id/participants",
  verifyToken,
  requireAdmin,
  async (req, res) => {
    const { event_id } = req.params;
    try {
      const result = await db.query(
        `SELECT ep.*, u.name FROM event_participants ep
       JOIN users u ON u.id = ep.user_id
       WHERE ep.event_id = $1`,
        [event_id]
      );

      res.json({ participants: result.rows });
    } catch (error) {
      console.error("Error fetching event participants:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

// ✅ POST /admin/record-stats – Record event stats
router.post("/record-stats", verifyToken, requireAdmin, async (req, res) => {
  const {
    event_id,
    user_id,
    score,
    points,
    birdies,
    strokes,
    putts,
    greens_in_reg,
    fairways_hit,
    notes,
    // Remove submitted_by here — we will get it from req.user.id
  } = req.body;

  const submitted_by = req.user.id; // <-- Use authenticated user's ID

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Insert or update participant stats, using submitted_by from req.user.id
    await client.query(
      `
      INSERT INTO event_participants (
        event_id, user_id, score, points, birdies, strokes, putts,
        greens_in_reg, fairways_hit, notes, submitted_by, submitted_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      ON CONFLICT (event_id, user_id)
      DO UPDATE SET
        score = EXCLUDED.score,
        points = EXCLUDED.points,
        birdies = EXCLUDED.birdies,
        strokes = EXCLUDED.strokes,
        putts = EXCLUDED.putts,
        greens_in_reg = EXCLUDED.greens_in_reg,
        fairways_hit = EXCLUDED.fairways_hit,
        notes = EXCLUDED.notes,
        submitted_by = EXCLUDED.submitted_by,
        submitted_at = NOW()
      `,
      [
        event_id,
        user_id,
        score,
        points,
        birdies,
        strokes,
        putts,
        greens_in_reg,
        fairways_hit,
        notes,
        submitted_by, // from req.user.id
      ]
    );

    // ✅ Update event_user_stats
    await client.query(
      `
  INSERT INTO event_user_stats (
    event_id, user_id, games_played, points, birdies, avg_points
  ) VALUES ($1, $2, 1, $3, $4, $5)
  ON CONFLICT (event_id, user_id)
  DO UPDATE SET
    games_played = event_user_stats.games_played + 1,
    points = event_user_stats.points + $3,
    birdies = event_user_stats.birdies + $4,
    avg_points = (event_user_stats.points::numeric + $5) / (event_user_stats.games_played + 1)::numeric
  `,
      [event_id, user_id, points, birdies, points]
    );

    // ✅ Update user_stats
    await client.query(
      `INSERT INTO user_stats (
    user_id, total_games, total_points, total_birdies, total_strokes,
    total_putts, greens_in_regulation, fairways_hit, avg_points, last_updated
  ) VALUES (
    $1, 1, $2, $3, $4, $5, $6, $7, $8, NOW()
  )
  ON CONFLICT (user_id)
  DO UPDATE SET
    total_games = COALESCE(user_stats.total_games, 0) + 1,
    total_points = COALESCE(user_stats.total_points, 0) + $2,
    total_birdies = COALESCE(user_stats.total_birdies, 0) + $3,
    total_strokes = COALESCE(user_stats.total_strokes, 0) + $4,
    total_putts = COALESCE(user_stats.total_putts, 0) + $5,
    greens_in_regulation = COALESCE(user_stats.greens_in_regulation, 0) + $6,
    fairways_hit = COALESCE(user_stats.fairways_hit, 0) + $7,
    avg_points = 
      CASE 
        WHEN COALESCE(user_stats.total_games, 0) + 1 = 0 THEN 0
        ELSE (COALESCE(user_stats.total_points, 0) + $8)::numeric / (COALESCE(user_stats.total_games, 0) + 1)
      END,
    last_updated = NOW()
  `,
      [
        user_id,
        points,
        birdies,
        strokes,
        putts,
        greens_in_reg,
        fairways_hit,
        points,
      ]
    );

    // ✅ Get user's club(s)
    const clubRes = await client.query(
      `SELECT club_id FROM club_members WHERE user_id = $1`,
      [user_id]
    );

    for (const row of clubRes.rows) {
      const club_id = row.club_id;

      // ✅ Update club_stats
      await client.query(
        `
  INSERT INTO club_stats (
    club_id, total_games, total_points, total_birdies,
    total_strokes, total_putts, greens_in_regulation,
    fairways_hit, avg_points_per_player, last_updated
  ) VALUES (
    $1, 1, $2, $3, $4, $5, $6, $7, $8, NOW()
  )
  ON CONFLICT (club_id)
  DO UPDATE SET
    total_games = club_stats.total_games + 1,
    total_points = club_stats.total_points + $2,
    total_birdies = club_stats.total_birdies + $3,
    total_strokes = club_stats.total_strokes + $4,
    total_putts = club_stats.total_putts + $5,
    greens_in_regulation = club_stats.greens_in_regulation + $6,
    fairways_hit = club_stats.fairways_hit + $7,
    avg_points_per_player = (club_stats.total_points::numeric + $8) / (club_stats.total_games + 1)::numeric,
    last_updated = NOW()
  `,
        [
          club_id,
          points,
          birdies,
          strokes,
          putts,
          greens_in_reg,
          fairways_hit,
          points,
        ] // 👈 duplicated
      );
    }

    await client.query("COMMIT");
    res.status(200).json({ message: "Stats recorded successfully." });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Record stats error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
});

export default router;
