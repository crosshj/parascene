import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import {
	COOKIE_NAME,
	ONE_WEEK_MS,
	clearAuthCookie,
	getJwtSecret,
	hashToken,
	setAuthCookie
} from "./auth.js";

export default function createProfileRoutes({ queries }) {
	const router = express.Router();

	function getTipperDisplayName(user) {
		const name =
			typeof user?.name === "string"
				? user.name.trim()
				: typeof user?.display_name === "string"
					? user.display_name.trim()
					: "";
		if (name) return name;
		const email = String(user?.email || "").trim();
		const localPart = email.includes("@") ? email.split("@")[0] : email;
		return `@${localPart || "user"}`;
	}

	router.post("/signup", async (req, res) => {
		const email = String(req.body.username || req.body.email || "")
			.trim()
			.toLowerCase();
		const password = String(req.body.password || "");

		if (!email || !password) {
			return res.status(400).send("Email and password are required.");
		}

		const existingUser = await queries.selectUserByEmail.get(email);
		if (existingUser) {
			return res.status(409).send("Email already registered.");
		}

		const passwordHash = bcrypt.hashSync(password, 12);
		const info = await queries.insertUser.run(email, passwordHash, "consumer");
		// Support both insertId (standardized) and lastInsertRowid (legacy SQLite)
		const userId = info.insertId || info.lastInsertRowid;

		// Initialize credits for new user with 100 starting credits
		try {
			await queries.insertUserCredits.run(userId, 100, null);
		} catch (error) {
			console.error(`[Signup] Failed to initialize credits for user ${userId}:`, {
				error: error.message,
				stack: error.stack,
				name: error.name
			});
			// Don't fail signup if credits initialization fails
		}

		const token = jwt.sign({ userId }, getJwtSecret(), { expiresIn: "7d" });
		setAuthCookie(res, token, req);
		if (queries.insertSession) {
			const tokenHash = hashToken(token);
			const expiresAt = new Date(Date.now() + ONE_WEEK_MS).toISOString();
			console.log(`[Signup] Creating session for new user ${userId}, expires at: ${expiresAt}`);
			try {
				await queries.insertSession.run(userId, tokenHash, expiresAt);
				console.log(`[Signup] Session created successfully for user ${userId}`);
			} catch (error) {
				console.error(`[Signup] Failed to create session for user ${userId}:`, {
					error: error.message,
					stack: error.stack,
					name: error.name
				});
				// Don't fail signup if session creation fails - cookie is still set
			}
		}

		return res.redirect("/");
	});

	router.post("/login", async (req, res) => {
		const email = String(req.body.username || req.body.email || "")
			.trim()
			.toLowerCase();
		const password = String(req.body.password || "");

		if (!email || !password) {
			return res.status(400).send("Email and password are required.");
		}

		const user = await queries.selectUserByEmail.get(email);
		if (!user || !bcrypt.compareSync(password, user.password_hash)) {
			return res.redirect("/auth.html#fail");
		}

		const token = jwt.sign({ userId: user.id }, getJwtSecret(), {
			expiresIn: "7d"
		});
		setAuthCookie(res, token, req);
		if (queries.insertSession) {
			const tokenHash = hashToken(token);
			const expiresAt = new Date(Date.now() + ONE_WEEK_MS).toISOString();
			console.log(`[Login] Creating session for user ${user.id}, expires at: ${expiresAt}`);
			try {
				await queries.insertSession.run(user.id, tokenHash, expiresAt);
				console.log(`[Login] Session created successfully for user ${user.id}`);
			} catch (error) {
				console.error(`[Login] Failed to create session for user ${user.id}:`, {
					error: error.message,
					stack: error.stack,
					name: error.name
				});
				// Don't fail login if session creation fails - cookie is still set
			}
		}
		return res.redirect("/");
	});

	router.post("/logout", async (req, res) => {
		if (queries.deleteSessionByTokenHash) {
			const token = req.cookies?.[COOKIE_NAME];
			if (token) {
				const tokenHash = hashToken(token);
				await queries.deleteSessionByTokenHash.run(
					tokenHash,
					req.auth?.userId
				);
			}
		}
		clearAuthCookie(res, req);
		res.redirect("/");
	});

	router.get("/me", (req, res) => {
		res.json({ userId: req.auth?.userId || null });
	});

	router.get("/api/profile", async (req, res) => {
		if (!req.auth?.userId) {
			return res.status(401).json({ error: "Unauthorized" });
		}

		const user = await queries.selectUserById.get(req.auth.userId);
		if (!user) {
			return res.status(404).json({ error: "User not found" });
		}

		// Get credits balance
		let credits = await queries.selectUserCredits.get(req.auth.userId);
		// If no credits record exists, initialize with 100 for existing users
		if (!credits) {
			try {
				await queries.insertUserCredits.run(req.auth.userId, 100, null);
				credits = { balance: 100 };
			} catch (error) {
				console.error(`[Profile] Failed to initialize credits for user ${req.auth.userId}:`, error);
				credits = { balance: 0 };
			}
		}

		return res.json({ ...user, credits: credits.balance });
	});

	router.get("/api/notifications", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}

			const user = await queries.selectUserById.get(req.auth.userId);
			if (!user) {
				return res.status(404).json({ error: "User not found" });
			}

			const notifications = await queries.selectNotificationsForUser.all(
				user.id,
				user.role
			);
			return res.json({ notifications });
		} catch (error) {
			console.error("Error loading notifications:", error);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	router.get("/api/notifications/unread-count", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.json({ count: 0 });
			}

			const user = await queries.selectUserById.get(req.auth.userId);
			if (!user) {
				return res.json({ count: 0 });
			}

			const result = await queries.selectUnreadNotificationCount.get(
				user.id,
				user.role
			);
			return res.json({ count: result?.count ?? 0 });
		} catch (error) {
			console.error("Error loading unread notification count:", error);
			return res.json({ count: 0 });
		}
	});

	router.post("/api/notifications/acknowledge", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}

			const user = await queries.selectUserById.get(req.auth.userId);
			if (!user) {
				return res.status(404).json({ error: "User not found" });
			}

			const id = Number(req.body?.id);
			if (!id) {
				return res.status(400).json({ error: "Notification id required" });
			}

			const result = await queries.acknowledgeNotificationById.run(
				id,
				user.id,
				user.role
			);
			return res.json({ ok: true, updated: result.changes });
		} catch (error) {
			console.error("Error acknowledging notification:", error);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	router.get("/api/credits", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}

			const credits = await queries.selectUserCredits.get(req.auth.userId);

			// If no credits record exists, initialize with 100
			if (!credits) {
				try {
					await queries.insertUserCredits.run(req.auth.userId, 100, null);
					const newCredits = await queries.selectUserCredits.get(req.auth.userId);
					return res.json({
						balance: newCredits.balance,
						canClaim: true,
						lastClaimDate: null
					});
				} catch (error) {
					console.error("Error initializing credits:", error);
					return res.status(500).json({ error: "Internal server error" });
				}
			}

			// Check if can claim (last claim was not today in UTC)
			const canClaim = (() => {
				if (!credits.last_daily_claim_at) return true;
				const now = new Date();
				const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
				const lastClaimDate = new Date(credits.last_daily_claim_at);
				const lastClaimUTC = new Date(Date.UTC(lastClaimDate.getUTCFullYear(), lastClaimDate.getUTCMonth(), lastClaimDate.getUTCDate()));
				return lastClaimUTC.getTime() < todayUTC.getTime();
			})();

			return res.json({
				balance: credits.balance,
				canClaim,
				lastClaimDate: credits.last_daily_claim_at
			});
		} catch (error) {
			console.error("Error loading credits:", error);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	router.post("/api/credits/claim", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}

			const result = await queries.claimDailyCredits.run(req.auth.userId, 10);

			if (!result.success) {
				return res.status(400).json({
					success: false,
					balance: result.balance,
					message: result.message || "Daily credits already claimed today"
				});
			}

			return res.json({
				success: true,
				balance: result.balance,
				message: "Daily credits claimed successfully"
			});
		} catch (error) {
			console.error("Error claiming daily credits:", error);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	router.post("/api/credits/tip", async (req, res) => {
		try {
			if (!req.auth?.userId) {
				return res.status(401).json({ error: "Unauthorized" });
			}

			if (!queries.transferCredits?.run) {
				return res.status(500).json({ error: "Credits transfer not available" });
			}

			const fromUserId = Number(req.auth.userId);
			const toUserId = Number(req.body?.toUserId);
			const rawAmount = Number(req.body?.amount);
			const amount = Math.round(rawAmount * 10) / 10;

			if (!Number.isFinite(toUserId) || toUserId <= 0) {
				return res.status(400).json({ error: "Invalid recipient user id" });
			}
			if (!Number.isFinite(amount) || amount <= 0) {
				return res.status(400).json({ error: "Invalid amount" });
			}
			if (toUserId === fromUserId) {
				return res.status(400).json({ error: "Cannot tip yourself" });
			}

			const sender = await queries.selectUserById.get(fromUserId);
			if (!sender) {
				return res.status(404).json({ error: "User not found" });
			}

			const recipient = await queries.selectUserById.get(toUserId);
			if (!recipient) {
				return res.status(404).json({ error: "Recipient not found" });
			}

			let transferResult;
			try {
				transferResult = await queries.transferCredits.run(fromUserId, toUserId, amount);
			} catch (error) {
				const message = String(error?.message || "");
				const code = error?.code || "";
				const isInsufficient =
					code === "INSUFFICIENT_CREDITS" ||
					message.toLowerCase().includes("insufficient");
				if (isInsufficient) {
					return res.status(400).json({ error: "Insufficient credits" });
				}
				const isSelfTip = message.toLowerCase().includes("tip yourself");
				if (isSelfTip) {
					return res.status(400).json({ error: "Cannot tip yourself" });
				}
				console.error("Error transferring credits:", error);
				return res.status(500).json({ error: "Internal server error" });
			}

			// Best-effort notification (no link, no new tables)
			try {
				if (queries.insertNotification?.run) {
					const tipperName = getTipperDisplayName(sender);
					const title = "You received a tip";
					const message = `${tipperName} tipped you ${amount.toFixed(1)} credits.`;
					await queries.insertNotification.run(toUserId, null, title, message, null);
				}
			} catch (error) {
				console.error("Failed to insert tip notification:", error);
				// do not fail the transfer
			}

			const fromBalance =
				transferResult && typeof transferResult.fromBalance === "number"
					? transferResult.fromBalance
					: transferResult && typeof transferResult.from_balance === "number"
						? transferResult.from_balance
						: null;
			const toBalance =
				transferResult && typeof transferResult.toBalance === "number"
					? transferResult.toBalance
					: transferResult && typeof transferResult.to_balance === "number"
						? transferResult.to_balance
						: null;

			return res.json({
				success: true,
				fromBalance,
				toBalance
			});
		} catch (error) {
			console.error("Error tipping credits:", error);
			return res.status(500).json({ error: "Internal server error" });
		}
	});

	return router;
}
