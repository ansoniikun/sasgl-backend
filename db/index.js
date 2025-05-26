import dotenv from "dotenv";
import pkg from "pg";

dotenv.config();
const { Pool } = pkg;

console.log("Connecting to:", process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export default pool;
