import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import pool from "../db/index.js";

const router = express.Router();

// Register route
router.post("/register", async (req, res) => {
  try {
    const { name, email, password, phone_number, role } = req.body;

    // Input validation: phone_number required, email optional
    if (!name || !password || !phone_number || !role) {
      return res
        .status(400)
        .json({ error: "Name, password, phone number, and role are required" });
    }

    const allowedRoles = ["player", "captain", "chairman", "admin"];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ error: "Invalid role selected" });
    }

    const cleanEmail = email ? email.trim().toLowerCase() : null;

    // Optional email uniqueness check
    if (cleanEmail) {
      const emailExists = await pool.query(
        "SELECT 1 FROM users WHERE email = $1",
        [cleanEmail]
      );
      if (emailExists.rows.length > 0) {
        return res.status(409).json({ error: "Email is already registered" });
      }
    }

    // Check for existing phone number
    const phoneExists = await pool.query(
      "SELECT 1 FROM users WHERE phone_number = $1",
      [phone_number]
    );
    if (phoneExists.rows.length > 0) {
      return res
        .status(409)
        .json({ error: "Phone number is already registered" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user
    const newUser = await pool.query(
      `INSERT INTO users (name, email, password_hash, phone_number, role, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING id, name, email, phone_number, role`,
      [name, cleanEmail, hashedPassword, phone_number, role]
    );

    return res.status(201).json(newUser.rows[0]);
  } catch (err) {
    console.error("REGISTER ERROR:", err);
    return res
      .status(500)
      .json({ error: "Registration failed", detail: err.message });
  }
});

// Login route using phone number
router.post("/login", async (req, res) => {
  try {
    const { phone_number, password } = req.body;

    if (!phone_number || !password) {
      return res
        .status(400)
        .json({ error: "Phone number and password are required" });
    }

    const result = await pool.query(
      "SELECT id, name, email, phone_number, password_hash, role FROM users WHERE phone_number = $1",
      [phone_number]
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
      { id: user.id, phone_number: user.phone_number, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    return res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        phone_number: user.phone_number,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    return res.status(500).json({ error: "Login failed", detail: err.message });
  }
});

router.post("/google-register", async (req, res) => {
  const { name, email, profile_picture, role } = req.body;

  try {
    // Check if user already exists
    const existingUser = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    let user;
    if (existingUser.rows.length === 0) {
      const result = await pool.query(
        `INSERT INTO users (name, email, role, profile_picture, auth_provider, created_at, updated_at)
   VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
   RETURNING *`,
        [name, email, role || "player", profile_picture, "google"]
      );

      user = result.rows[0];
    } else {
      user = existingUser.rows[0];
    }

    res.status(200).json({ user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Google Login Route
router.post("/google-login", async (req, res) => {
  const { email } = req.body;

  try {
    const cleanEmail = email.trim().toLowerCase();

    const result = await pool.query(
      "SELECT id, name, email, role FROM users WHERE email = $1 AND auth_provider = 'google'",
      [cleanEmail]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: "User not registered with Google" });
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
    console.error("GOOGLE LOGIN ERROR:", err);
    return res
      .status(500)
      .json({ error: "Google login failed", detail: err.message });
  }
});

export default router;
