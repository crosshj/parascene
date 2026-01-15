import bcrypt from "bcryptjs";
import { openDb } from "./index.js";

const SEED_USERS = [
  {
    email: "consumer@example.com",
    password: "password123@#",
    role: "consumer"
  },
  {
    email: "creator@example.com",
    password: "password123@#",
    role: "creator"
  },
  {
    email: "provider@example.com",
    password: "password123@#",
    role: "provider"
  },
  {
    email: "admin@example.com",
    password: "password123@#",
    role: "admin"
  }
];

const { db, queries } = openDb();

for (const user of SEED_USERS) {
  const existing = queries.selectUserByEmail.get(user.email);
  if (existing) continue;

  const passwordHash = bcrypt.hashSync(user.password, 12);
  queries.insertUser.run(user.email, passwordHash, user.role);
}

db.close();
console.log("Seed complete.");
