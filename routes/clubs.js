import express from "express";
import { verifyToken, requireCaptain } from "../middleware/auth.js";
import pool from "../db/index.js";
const router = express.Router();

router.post("/register", verifyToken, async (req, res) => {
  const {
    clubName,
    clubDescription,
    captainContactNo,
    isPrivateClub,
    clubLogoUrl,
  } = req.body;

  const userId = req.user.id;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const userResult = await client.query(
      "SELECT name, email FROM users WHERE id = $1",
      [userId]
    );

    const user = userResult.rows[0];

    if (!user) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "User not found." });
    }

    // Check if user already created a club
    const existingClub = await client.query(
      "SELECT id FROM clubs WHERE created_by = $1",
      [userId]
    );

    if (existingClub.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        message: "Cannot create club. You already have a club.",
      });
    }

    // Insert new club
    const clubResult = await client.query(
      `
      INSERT INTO clubs (
        name,
        description,
        logo_url,
        created_by,
        is_private,
        approved,
        captain_name,
        captain_email,
        captain_contact_no,
        created_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, NOW(), NOW()
      )
      RETURNING id
      `,
      [
        clubName,
        clubDescription,
        clubLogoUrl || null,
        userId,
        isPrivateClub === "true" || isPrivateClub === true,
        true,
        user.name,
        user.email,
        captainContactNo,
      ]
    );

    const clubId = clubResult.rows[0].id;

    // Insert captain as member
    await client.query(
      `
      INSERT INTO club_members (
        club_id,
        user_id,
        role,
        status,
        joined_at
      ) VALUES ($1, $2, $3, $4, NOW())
      `,
      [clubId, userId, "captain", "approved"]
    );

    await client.query("COMMIT");

    res.status(201).json({
      message: "Club registered successfully.",
      clubId,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error registering club:", err);
    res.status(500).json({ error: "Failed to register club" });
  } finally {
    client.release();
  }
});

// --- GET all approved clubs ---
router.get("/all", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, description, logo_url FROM clubs WHERE approved = true`
    );
    // Make sure result.rows is an array (it should be)
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    // Instead of just `{ error: "Failed to fetch clubs" }`, return an empty array to avoid front-end crash
    res.status(500).json([]);
  }
});

// --- POST request to join a club ---
router.post("/request", verifyToken, async (req, res) => {
  const { clubId } = req.body;
  const userId = req.user.id;

  try {
    const existing = await pool.query(
      `SELECT * FROM club_members WHERE club_id = $1 AND user_id = $2`,
      [clubId, userId]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: "Request already exists" });
    }

    await pool.query(
      `INSERT INTO club_members (club_id, user_id, status, joined_at)
       VALUES ($1, $2, 'pending', NOW())`,
      [clubId, userId]
    );

    res.json({ message: "Request submitted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to submit request" });
  }
});

router.get("/myclubs", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `
      SELECT DISTINCT c.id, c.name
      FROM club_members cm
      JOIN clubs c ON cm.club_id = c.id
      WHERE cm.user_id = $1 AND cm.status = 'approved'
      `,
      [userId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Failed to fetch user clubs:", err);
    res.status(500).json({ error: "Failed to fetch clubs" });
  }
});

router.get("/myclub", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Try finding the club where user is the captain
    const captainResult = await pool.query(
      `SELECT * FROM clubs WHERE created_by = $1`,
      [userId]
    );

    if (captainResult.rows.length > 0) {
      return res.json(captainResult.rows[0]);
    }

    // Else, check if the user is an approved member of a club
    const memberResult = await pool.query(
      `
      SELECT c.*
      FROM club_members cm
      JOIN clubs c ON cm.club_id = c.id
      WHERE cm.user_id = $1 AND cm.status = 'approved'
      `,
      [userId]
    );

    if (memberResult.rows.length > 0) {
      return res.json(memberResult.rows[0]);
    }

    return res.status(404).json({ error: "No associated club found" });
  } catch (err) {
    console.error("Failed to fetch club:", err);
    res.status(500).json({ error: "Failed to fetch club" });
  }
});

// GET /api/clubs/user-requests
router.get("/user-requests", verifyToken, async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT club_id, status
       FROM club_members
       WHERE user_id = $1`,
      [userId]
    );

    res.json(result.rows); // [{ club_id: 1, status: 'pending' }, ...]
  } catch (err) {
    console.error("Error fetching user club requests:", err);
    res.status(500).json({ error: "Failed to fetch join requests" });
  }
});

// GET /api/clubs/:id
router.get("/:id", verifyToken, async (req, res) => {
  const clubId = req.params.id;

  try {
    const result = await pool.query(`SELECT * FROM clubs WHERE id = $1`, [
      clubId,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Club not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Failed to fetch club by ID:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/clubs
router.get("/", async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name FROM "clubs"');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

// GET /api/clubs/user-clubs
router.get("/user-clubs", verifyToken, async (req, res) => {
  const userId = req.user?.id;

  if (!userId) {
    return res.status(401).json({ error: "User not authenticated" });
  }

  try {
    const [rows] = await db.execute(
      "SELECT club_id FROM club_members WHERE user_id = ?",
      [userId]
    );

    const clubIds = rows.map((row) => row.club_id);
    res.json(clubIds);
  } catch (error) {
    console.error("Error fetching user clubs:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/clubs/:id/members
router.get("/:id/members", verifyToken, async (req, res) => {
  const userId = req.user.id;
  const clubId = req.params.id;

  try {
    // Check if user is an approved member or captain
    const checkMemberQuery = `
      SELECT role FROM club_members 
      WHERE club_id = $1 AND user_id = $2 AND status = 'approved'
    `;
    const { rows: allowedRows } = await pool.query(checkMemberQuery, [
      clubId,
      userId,
    ]);

    if (allowedRows.length === 0) {
      return res
        .status(403)
        .json({ error: "Access denied: You are not a member of this club" });
    }

    // Fetch club members with total_points from user_stats and profile_picture from users
    const fetchMembersQuery = `
      SELECT 
        u.id,
        u.name,
        u.email,
        u.phone_number,
        u.role,
        u.profile_picture,
        cm.status,
        cm.joined_at,
        COALESCE(us.total_points, 0) AS score
      FROM club_members cm
      JOIN users u ON u.id = cm.user_id
      LEFT JOIN user_stats us ON us.user_id = u.id
      WHERE cm.club_id = $1
      ORDER BY cm.joined_at DESC;
    `;
    const { rows } = await pool.query(fetchMembersQuery, [clubId]);

    res.json(rows);
  } catch (error) {
    console.error("Failed to fetch club members:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/clubs/:clubId/members/:userId/approve
router.patch(
  "/:clubId/members/:userId/approve",
  verifyToken,
  async (req, res) => {
    const { clubId, userId } = req.params;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Approve the member
      const result = await client.query(
        `UPDATE club_members 
       SET status = 'approved', role = 'player' 
       WHERE club_id = $1 AND user_id = $2 
       RETURNING *`,
        [clubId, userId]
      );

      if (result.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Member not found" });
      }

      // 2. Get all events for the club
      const eventsResult = await client.query(
        `SELECT id FROM events WHERE club_id = $1`,
        [clubId]
      );

      const events = eventsResult.rows;

      // 3. Insert into event_participants for each event
      for (const event of events) {
        await client.query(
          `INSERT INTO event_participants 
            (event_id, user_id, club_id, points, stats, games_played, submitted_by, submitted_at, strokes, putts, greens_in_reg, fairways_hit, notes, birdies)
           VALUES 
            ($1, $2, $3, 0, '{}'::jsonb, 0, NULL, NULL, 0, 0, 0, 0, '', 0)`,
          [event.id, userId, clubId]
        );
      }

      await client.query("COMMIT");

      res.json({
        success: true,
        member: result.rows[0],
        addedToEvents: events.length,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Error approving member:", error);
      res.status(500).json({ error: "Internal server error" });
    } finally {
      client.release();
    }
  }
);

// DELETE /api/clubs/:clubId/members/:userId/reject
router.patch(
  "/:clubId/members/:userId/reject",
  verifyToken,
  async (req, res) => {
    const { clubId, userId } = req.params;
    const currentUserId = req.user.id;

    try {
      // Confirm that the requester is the club's captain
      const club = await pool.query(
        `SELECT * FROM clubs WHERE id = $1 AND created_by = $2`,
        [clubId, currentUserId]
      );

      if (club.rows.length === 0) {
        return res
          .status(403)
          .json({ error: "Unauthorized: Only captains can reject requests" });
      }

      // Delete the pending join request
      const result = await pool.query(
        `DELETE FROM club_members WHERE club_id = $1 AND user_id = $2 AND status = 'pending' RETURNING *`,
        [clubId, userId]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: "Pending request not found" });
      }

      res.json({
        success: true,
        message: "Join request rejected and removed.",
      });
    } catch (error) {
      console.error("Error rejecting member:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// DELETE /api/clubs/:clubId/members/:userId/remove
router.delete(
  "/:clubId/members/:userId/remove",
  verifyToken,
  async (req, res) => {
    const { clubId, userId } = req.params;
    const currentUserId = req.user.id;

    const client = await pool.connect();
    try {
      // Check if current user is captain or chairman of the club
      const roleCheck = await client.query(
        `SELECT role FROM club_members WHERE club_id = $1 AND user_id = $2 AND status = 'approved'`,
        [clubId, currentUserId]
      );

      if (roleCheck.rows.length === 0) {
        return res.status(403).json({ error: "Unauthorized" });
      }

      const role = roleCheck.rows[0].role;
      if (role !== "captain" && role !== "chairman") {
        return res
          .status(403)
          .json({ error: "Only captain or chairman can remove members" });
      }

      await client.query("BEGIN");

      // Remove from club_members
      const result = await client.query(
        `DELETE FROM club_members WHERE club_id = $1 AND user_id = $2 AND status = 'approved' RETURNING *`,
        [clubId, userId]
      );

      if (result.rowCount === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Approved member not found" });
      }

      // Also remove from event_participants
      await client.query(
        `DELETE FROM event_participants WHERE club_id = $1 AND user_id = $2`,
        [clubId, userId]
      );

      await client.query("COMMIT");
      res.json({ success: true, message: "Member removed successfully" });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("Error removing member:", err);
      res.status(500).json({ error: "Internal server error" });
    } finally {
      client.release();
    }
  }
);

// GET /api/clubs/:id/events
router.get("/:id/events", async (req, res) => {
  const { id: clubId } = req.params;

  try {
    const result = await pool.query(
      `SELECT * FROM events WHERE club_id = $1 ORDER BY start_date DESC`,
      [clubId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching club events:", err);
    res.status(500).json({ error: "Failed to fetch club events" });
  }
});

//Update club edit
router.patch("/:id", verifyToken, async (req, res) => {
  const clubId = req.params.id;
  const userId = req.user.id;
  const { name, description, logo, home_estate, country, established_year } =
    req.body;

  try {
    // Ensure user is the captain or creator of the club
    const { rows } = await pool.query(
      `SELECT * FROM clubs WHERE id = $1 AND created_by = $2`,
      [clubId, userId]
    );

    if (rows.length === 0) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    await pool.query(
      `UPDATE clubs
       SET name = $1,
           description = $2,
           logo_url = $3,
           home_estate = $4,
           country = $5,
           established_year = $6,
           updated_at = NOW()
       WHERE id = $7`,
      [name, description, logo, home_estate, country, established_year, clubId]
    );

    res.json({ message: "Club updated successfully" });
  } catch (err) {
    console.error("Failed to update club:", err);
    res.status(500).json({ error: "Failed to update club" });
  }
});

router.get("/league/:clubId", async (req, res) => {
  const clubId = req.params.clubId;

  try {
    const result = await pool.query(
      `
      WITH ranked_scores AS (
        SELECT 
          ep.user_id,
          u.name,
          ep.points,
          ROW_NUMBER() OVER (PARTITION BY ep.user_id ORDER BY ep.points DESC) AS rank
        FROM event_participants ep
        JOIN users u ON u.id = ep.user_id
        WHERE ep.club_id = $1
      )
      SELECT 
        user_id,
        name,
        ARRAY_AGG(points ORDER BY rank) AS scores
      FROM ranked_scores
      WHERE rank <= 4
      GROUP BY user_id, name
      ORDER BY SUM(points) DESC
      `,
      [clubId]
    );

    const leaderboard = result.rows.map((row) => {
      const scores = row.scores;
      const total = scores.reduce((sum, p) => sum + p, 0);
      return {
        user_id: row.user_id,
        name: row.name,
        scores,
        total,
      };
    });

    res.json({ leaderboard });
  } catch (err) {
    console.error("Error fetching league leaderboard:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/submit-stats", verifyToken, requireCaptain, async (req, res) => {
  const {
    eventId,
    userId,
    points = 0,
    birdies = 0,
    strokes = 0,
    putts = 0,
    greensInRegulation = 0,
    fairwaysHit = 0,
    notes = "",
  } = req.body;

  const submittedBy = req.user.id;

  // Validate required fields
  if (!eventId || !userId) {
    return res
      .status(400)
      .json({ error: "Missing or invalid required fields" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Insert or update stats in event_participants
    await client.query(
      `
        INSERT INTO event_participants (
          event_id, user_id, points, birdies, strokes, putts,
          greens_in_reg, fairways_hit, notes, submitted_by, submitted_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
        ON CONFLICT (event_id, user_id)
        DO UPDATE SET
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
        eventId,
        userId,
        points,
        birdies,
        strokes,
        putts,
        greensInRegulation,
        fairwaysHit,
        notes,
        submittedBy,
      ]
    );

    // Update event_user_stats
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
      [eventId, userId, points, birdies, points]
    );

    // Update user_stats
    await client.query(
      `
        INSERT INTO user_stats (
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
        userId,
        points,
        birdies,
        strokes,
        putts,
        greensInRegulation,
        fairwaysHit,
        points,
      ]
    );

    // Get user clubs
    const clubRes = await client.query(
      `SELECT club_id FROM club_members WHERE user_id = $1`,
      [userId]
    );

    // Parallel update club_stats
    await Promise.all(
      clubRes.rows.map(({ club_id }) =>
        client.query(
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
            greensInRegulation,
            fairwaysHit,
            points,
          ]
        )
      )
    );

    await client.query("COMMIT");
    res.status(200).json({ message: "Stats recorded successfully." });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error recording stats:", error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

// Get events by club_id
router.get("/events/:clubId", async (req, res) => {
  const { clubId } = req.params;

  try {
    const result = await pool.query(
      "SELECT id, name FROM events WHERE club_id = $1",
      [clubId]
    );
    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error fetching events:", error);
    res.status(500).json({ error: "Internal server error." });
  }
});

// Get participants for an event with names
router.get("/event-participants/:eventId", async (req, res) => {
  const { eventId } = req.params;

  try {
    const result = await pool.query(
      `
      SELECT u.id as user_id, u.name
      FROM event_participants ep
      JOIN users u ON ep.user_id = u.id
      WHERE ep.event_id = $1
      `,
      [eventId]
    );
    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error fetching participants:", error);
    res.status(500).json({ error: "Internal server error." });
  }
});

// POST /api/clubs/:clubId/events — Captains create events
router.post("/:clubId/events", verifyToken, async (req, res) => {
  const { clubId } = req.params;
  const { name, type, description, start_date, end_date, handicap, location } =
    req.body;

  const client = await pool.connect();

  try {
    // Check if user is an approved captain/chairman
    const roleCheck = await client.query(
      `SELECT role FROM club_members WHERE club_id = $1 AND user_id = $2 AND status = 'approved'`,
      [clubId, req.user.id]
    );

    const role = roleCheck.rows[0]?.role;
    if (!role || !["captain", "chairman"].includes(role)) {
      return res.status(403).json({ error: "Access denied" });
    }

    await client.query("BEGIN");

    // Step 1: Create event
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
        clubId,
        req.user.id,
      ]
    );

    const event = eventResult.rows[0];

    // Step 2: Add approved club members to event_participants
    const membersResult = await client.query(
      `SELECT user_id FROM club_members WHERE club_id = $1 AND status = 'approved'`,
      [clubId]
    );

    for (const { user_id } of membersResult.rows) {
      await client.query(
        `INSERT INTO event_participants (
          event_id, user_id, club_id, points, stats, games_played, submitted_by, 
          submitted_at, strokes, putts, greens_in_reg, fairways_hit, notes, birdies
        ) VALUES (
          $1, $2, $3, 0, '{}'::jsonb, 0, NULL, NULL, 0, 0, 0, 0, '', 0
        )`,
        [event.id, user_id, clubId]
      );
    }

    await client.query("COMMIT");
    res.status(201).json(event);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Club Event Creation Error:", error);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

// PUT /api/clubs/events/:id — Edit event
router.put("/events/:id", verifyToken, async (req, res) => {
  const { id } = req.params;
  const { name, type, description, start_date } = req.body;

  const client = await pool.connect();

  try {
    // Get event to check club and creator
    const eventCheck = await client.query(
      "SELECT club_id FROM events WHERE id = $1",
      [id]
    );
    if (eventCheck.rows.length === 0) {
      return res.status(404).json({ error: "Event not found" });
    }

    const { club_id } = eventCheck.rows[0];

    // Check role
    const roleRes = await client.query(
      `SELECT role FROM club_members 
       WHERE club_id = $1 AND user_id = $2 AND status = 'approved'`,
      [club_id, req.user.id]
    );

    const role = roleRes.rows[0]?.role;
    if (!role || !["captain", "chairman"].includes(role)) {
      return res.status(403).json({ error: "Access denied" });
    }

    const updateRes = await client.query(
      `UPDATE events SET 
        name = $1,
        type = $2,
        description = $3,
        start_date = $4,
        updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [name, type, description, start_date, id]
    );

    res.status(200).json(updateRes.rows[0]);
  } catch (err) {
    console.error("Edit Event Error:", err);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

// DELETE /api/clubs/events/:eventId
router.delete("/events/:eventId", verifyToken, async (req, res) => {
  const { eventId } = req.params;
  const userId = req.user.id;

  try {
    // Check if the user created the event or is captain
    const eventCheck = await pool.query(
      `SELECT club_id FROM events WHERE id = $1`,
      [eventId]
    );

    if (eventCheck.rows.length === 0) {
      return res.status(404).json({ error: "Event not found" });
    }

    const { club_id } = eventCheck.rows[0];

    const roleRes = await pool.query(
      `SELECT role FROM club_members 
       WHERE club_id = $1 AND user_id = $2 AND status = 'approved'`,
      [club_id, userId]
    );

    const role = roleRes.rows[0]?.role;

    if (!["captain", "chairman"].includes(role)) {
      return res.status(403).json({ error: "Access denied" });
    }

    await pool.query(`DELETE FROM events WHERE id = $1`, [eventId]);

    res.status(200).json({ message: "Event deleted successfully." });
  } catch (err) {
    console.error("Error deleting event:", err);
    res.status(500).json({ error: "Failed to delete event" });
  }
});

export default router;
