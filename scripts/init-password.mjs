import bcrypt from "bcryptjs";

const raw = process.argv[2];
if (!raw) {
  console.error("Usage: node scripts/init-password.mjs <password>");
  process.exit(1);
}

const hash = await bcrypt.hash(raw, 10);
console.log(hash);
