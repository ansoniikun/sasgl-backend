import express from "express";
import { verifyToken } from "../middleware/auth.js";
import pool from "../db/index.js";
import bcrypt from "bcrypt";
import multer from "multer";
import path from "path";
import fs from "fs";

const router = express.Router();

// Multer setup for logo uploads
// Upload config
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/logos");
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});
const upload = multer({ storage });

// POST /api/clubs/register
router.post(
  "/register",
  verifyToken,
  upload.single("clubLogo"),
  async (req, res) => {
    const {
      clubName,
      clubEmail,
      clubPhone,
      clubDescription,
      captainContactNo,
      isPrivateClub,
    } = req.body;

    const userId = req.user.id;
    const logoPath = req.file ? `/uploads/logos/${req.file.filename}` : null;

    try {
      const userResult = await pool.query(
        "SELECT name, email FROM users WHERE id = $1",
        [userId]
      );
      const user = userResult.rows[0];

      if (!user) {
        return res.status(404).json({ message: "User not found." });
      }

      // 🛑 Check if user already created a club
      const existingClub = await pool.query(
        "SELECT id FROM clubs WHERE created_by = $1",
        [userId]
      );

      if (existingClub.rows.length > 0) {
        return res
          .status(400)
          .json({ message: "Cannot create club. You have an existing club." });
      }

      // Promote user to captain
      await pool.query("UPDATE users SET role = 'captain' WHERE id = $1", [
        userId,
      ]);

      // Create new club
      await pool.query(
        `
      INSERT INTO clubs
        (name, email, phone, description, logo_url, created_by, is_private, status,
         captain_name, captain_email, captain_contact_no, created_at, updated_at)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, 'pending',
         $8, $9, $10, NOW(), NOW())
      RETURNING id
      `,
        [
          clubName,
          clubEmail,
          clubPhone,
          clubDescription,
          logoPath,
          userId,
          isPrivateClub === "true" || isPrivateClub === true,
          user.name,
          user.email,
          captainContactNo,
        ]
      );

      return res.status(201).json({ message: "Club registered successfully." });
    } catch (err) {
      console.error("Error registering club:", err);
      return res.status(500).json({ error: "Failed to register club" });
    }
  }
);

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

    // Fetch club members
    const fetchMembersQuery = `
      SELECT 
        u.id,
        u.name,
        u.email,
        u.role,
        cm.status,
        cm.joined_at
      FROM club_members cm
      JOIN users u ON u.id = cm.user_id
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

    try {
      const result = await pool.query(
        `UPDATE club_members SET status = 'approved' WHERE club_id = $1 AND user_id = $2 RETURNING *`,
        [clubId, userId]
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: "Member not found" });
      }

      res.json({ success: true, member: result.rows[0] });
    } catch (error) {
      console.error("Error approving member:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// DELETE /api/clubs/:clubId/members/:userId/reject
router.delete(
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

router.patch("/:id", verifyToken, async (req, res) => {
  const clubId = req.params.id;
  const userId = req.user.id;
  const { name, email, phone, description, is_private } = req.body;

  try {
    // Ensure user is the captain of the club
    const { rows } = await pool.query(
      `SELECT * FROM clubs WHERE id = $1 AND created_by = $2`,
      [clubId, userId]
    );

    if (rows.length === 0) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    await pool.query(
      `UPDATE clubs
       SET name = $1, email = $2, phone = $3, description = $4, is_private = $5, updated_at = NOW()
       WHERE id = $6`,
      [name, email, phone, description, is_private === "true", clubId]
    );

    res.json({ message: "Club updated successfully" });
  } catch (err) {
    console.error("Failed to update club:", err);
    res.status(500).json({ error: "Failed to update club" });
  }
});

export default router;
