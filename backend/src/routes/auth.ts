import { Router } from "express";
import bcrypt from "bcryptjs";
import { config } from "../config.js";

export const authRouter = Router();

authRouter.get("/me", (req, res) => {
  if (!req.session.authenticated) {
    return res.status(401).json({ authenticated: false });
  }
  return res.json({ authenticated: true });
});

authRouter.post("/login", async (req, res) => {
  const password = String(req.body?.password ?? "");
  const ok = await bcrypt.compare(password, config.adminPasswordHash);
  if (!ok) {
    return res.status(401).json({ message: "Invalid password" });
  }

  req.session.authenticated = true;
  return res.json({ success: true });
});

authRouter.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});
