import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import pool from "../db/index.js";

const router = express.Router();

// Register route
router.post("/register", async (req, res) => {
  try {
    const { name, email, password, phone_number } = req.body;

    // Basic input validation
    if (!name || !email || !password || !phone_number) {
      return res.status(400).json({ error: "All fields are required" });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Check if user already exists
    const userExists = await pool.query(
      "SELECT 1 FROM users WHERE email = $1",
      [cleanEmail]
    );
    if (userExists.rows.length > 0) {
      return res.status(409).json({ error: "User already exists" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    const newUser = await pool.query(
      `INSERT INTO users (name, email, password_hash, phone_number, role, created_at)
       VALUES ($1, $2, $3, $4, 'player', NOW())
       RETURNING id, name, email, phone_number, role`,
      [name, cleanEmail, hashedPassword, phone_number]
    );

    return res.status(201).json(newUser.rows[0]);
  } catch (err) {
    console.error("REGISTER ERROR:", err);
    return res
      .status(500)
      .json({ error: "Registration failed", detail: err.message });
  }
});

// Login route
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const cleanEmail = email.trim().toLowerCase();

    const result = await pool.query(
      "SELECT id, name, email, password_hash, role FROM users WHERE email = $1",
      [cleanEmail]
    );

    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    return res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    return res.status(500).json({ error: "Login failed", detail: err.message });
  }
});

export default router;
