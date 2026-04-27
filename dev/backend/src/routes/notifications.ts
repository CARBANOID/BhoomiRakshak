import { Prisma } from "@prisma/client";
import { Router } from "express";
import { authMiddleWare } from "../auth.js";
import { prismaClient } from "../lib/prisma.js";
import { zodCreateNotificationAuditSchema, zodUpdateNotificationPreferenceSchema } from "../zodSchema.js";

const notificationsRouter = Router();

notificationsRouter.get("/notifications/preferences", authMiddleWare, async (req, res) => {
	const userId = req.userId;
	if (!userId) {
		res.status(403).json({ message: "unauthorized access !! please sign in first !", logout: true });
		return;
	}

	const preference = await prismaClient.notificationPreference.upsert({
		where: { userId },
		create: {
			userId,
			emailEnabled: true,
			criticalOnly: false,
			digestCadence: "off"
		},
		update: {}
	});

	res.status(200).json({ preference });
});

notificationsRouter.patch("/notifications/preferences", authMiddleWare, async (req, res) => {
	const parsed = await zodUpdateNotificationPreferenceSchema.safeParseAsync(req.body);
	if (!parsed.success) {
		res.status(411).json({ message: parsed.error.message });
		return;
	}

	const userId = req.userId;
	if (!userId) {
		res.status(403).json({ message: "unauthorized access !! please sign in first !", logout: true });
		return;
	}

	const { emailEnabled, criticalOnly, digestCadence } = parsed.data;
	const updateData: Prisma.NotificationPreferenceUncheckedUpdateInput = {};
	if (typeof emailEnabled !== "undefined") {
		updateData.emailEnabled = emailEnabled;
	}
	if (typeof criticalOnly !== "undefined") {
		updateData.criticalOnly = criticalOnly;
	}
	if (typeof digestCadence !== "undefined") {
		updateData.digestCadence = digestCadence;
	}

	const preference = await prismaClient.notificationPreference.upsert({
		where: { userId },
		create: {
			userId,
			emailEnabled: emailEnabled ?? true,
			criticalOnly: criticalOnly ?? false,
			digestCadence: digestCadence ?? "off"
		},
		update: updateData
	});

	res.status(200).json({ message: "notification preference updated", preference });
});

notificationsRouter.get("/notifications/messages", authMiddleWare, async (req, res) => {
	const userId = req.userId;
	if (!userId) {
		res.status(403).json({ message: "unauthorized access !! please sign in first !", logout: true });
		return;
	}

	const { status, category, channel, page = "1", limit = "20" } = req.query;

	const parsedPage = Number.parseInt(typeof page === "string" ? page : "1", 10);
	const parsedLimit = Number.parseInt(typeof limit === "string" ? limit : "20", 10);
	if (!Number.isFinite(parsedPage) || parsedPage < 1) {
		res.status(400).json({ message: "page must be a positive integer" });
		return;
	}
	if (!Number.isFinite(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
		res.status(400).json({ message: "limit must be an integer between 1 and 100" });
		return;
	}

	const where: Prisma.NotificationMessageAuditWhereInput = { userId };
	if (typeof status === "string" && status.length > 0) {
		where.status = status;
	}
	if (typeof category === "string" && category.length > 0) {
		where.category = category;
	}
	if (typeof channel === "string" && channel.length > 0) {
		where.channel = channel;
	}

	const skip = (parsedPage - 1) * parsedLimit;
	const [messages, total] = await Promise.all([
		prismaClient.notificationMessageAudit.findMany({
			where,
			orderBy: { createdAt: "desc" },
			skip,
			take: parsedLimit
		}),
		prismaClient.notificationMessageAudit.count({ where })
	]);

	res.status(200).json({
		messages,
		pagination: {
			page: parsedPage,
			limit: parsedLimit,
			total,
			totalPages: Math.max(1, Math.ceil(total / parsedLimit))
		}
	});
});

notificationsRouter.post("/notifications/messages", authMiddleWare, async (req, res) => {
	const parsed = await zodCreateNotificationAuditSchema.safeParseAsync(req.body);
	if (!parsed.success) {
		res.status(411).json({ message: parsed.error.message });
		return;
	}

	const userId = req.userId;
	if (!userId) {
		res.status(403).json({ message: "unauthorized access !! please sign in first !", logout: true });
		return;
	}

	const { channel, category, target, subject, body, status, errorMessage, metadata } = parsed.data;
	const createData: Prisma.NotificationMessageAuditUncheckedCreateInput = {
		userId,
		channel,
		category,
		target,
		subject,
		body,
		status: status ?? "queued",
		errorMessage: errorMessage ?? null,
		attemptedAt: status && status !== "queued" ? new Date() : null,
		deliveredAt: status === "sent" ? new Date() : null
	};

	if (typeof metadata !== "undefined") {
		createData.metadata = metadata as Prisma.InputJsonValue;
	}

	const audit = await prismaClient.notificationMessageAudit.create({
		data: createData
	});

	res.status(200).json({ message: "notification message audit recorded", audit });
});

export { notificationsRouter };
