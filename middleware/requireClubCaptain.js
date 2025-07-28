import pool from "../db/index.js";

const requireClubCaptain = async (req, res, next) => {
  const userId = req.user.id;
  const { event_id } = req.body;

  try {
    const result = await pool.query(
      `
      SELECT cm.club_id FROM club_members cm
      JOIN events e ON e.club_id = cm.club_id
      WHERE cm.user_id = $1 AND cm.role IN ('captain', 'chairman') AND e.id = $2
      `,
      [userId, event_id]
    );

    if (result.rows.length === 0) {
      return res
        .status(403)
        .json({ error: "Only club captains can submit scores." });
    }

    next();
  } catch (error) {
    console.error("Club captain check failed:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export default requireClubCaptain;
