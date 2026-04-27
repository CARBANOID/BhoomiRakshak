import { AlertStatus } from "@prisma/client";
import { Router } from "express";
import { authMiddleWare } from "../auth.js";
import { prismaClient } from "../lib/prisma.js";

const alertsRouter = Router();

const alertStatuses = new Set(Object.values(AlertStatus));

alertsRouter.get("/alerts", authMiddleWare, async (req, res) => {
	const userId = req.userId;
	if (!userId) {
		res.status(403).json({ message: "unauthorized access !! please sign in first !", logout: true });
		return;
	}

	const { aoiId, status, severity } = req.query;

	const where: {
		userId: string;
		aoiId?: string;
		status?: AlertStatus;
		severity?: string;
	} = { userId };

	if (typeof aoiId === "string" && aoiId.length > 0) {
		where.aoiId = aoiId;
	}
	if (typeof status === "string" && alertStatuses.has(status as AlertStatus)) {
		where.status = status as AlertStatus;
	}
	if (typeof severity === "string" && severity.length > 0) {
		where.severity = severity;
	}

	const alerts = await prismaClient.alert.findMany({
		where,
		orderBy: {
			createdAt: "desc"
		},
		take: 200
	});

	res.status(200).json({ alerts });
});

alertsRouter.patch("/alerts/:alertId/read", authMiddleWare, async (req, res) => {
	const userId = req.userId;
	if (!userId) {
		res.status(403).json({ message: "unauthorized access !! please sign in first !", logout: true });
		return;
	}

	const alertId = req.params.alertId;
	if (!alertId) {
		res.status(400).json({ message: "alertId is required" });
		return;
	}

	const updated = await prismaClient.alert.updateMany({
		where: {
			id: alertId,
			userId,
			readAt: null
		},
		data: {
			readAt: new Date()
		}
	});

	if (updated.count === 0) {
		res.status(404).json({ message: "alert not found" });
		return;
	}

	res.status(200).json({ message: "alert marked as read" });
});

alertsRouter.patch("/alerts/:alertId/resolve", authMiddleWare, async (req, res) => {
	const userId = req.userId;
	if (!userId) {
		res.status(403).json({ message: "unauthorized access !! please sign in first !", logout: true });
		return;
	}

	const alertId = req.params.alertId;
	if (!alertId) {
		res.status(400).json({ message: "alertId is required" });
		return;
	}

	const updated = await prismaClient.alert.updateMany({
		where: {
			id: alertId,
			userId,
			status: AlertStatus.active
		},
		data: {
			status: AlertStatus.resolved,
			resolvedAt: new Date()
		}
	});

	if (updated.count === 0) {
		res.status(404).json({ message: "alert not found" });
		return;
	}

	res.status(200).json({ message: "alert resolved" });
});

alertsRouter.patch("/alerts/:alertId/acknowledge", authMiddleWare, async (req, res) => {
	const userId = req.userId;
	if (!userId) {
		res.status(403).json({ message: "unauthorized access !! please sign in first !", logout: true });
		return;
	}

	const alertId = req.params.alertId;
	if (!alertId) {
		res.status(400).json({ message: "alertId is required" });
		return;
	}

	const updated = await prismaClient.alert.updateMany({
		where: {
			id: alertId,
			userId,
			status: AlertStatus.active
		},
		data: {
			status: AlertStatus.acknowledged,
			acknowledgedAt: new Date()
		}
	});

	if (updated.count === 0) {
		res.status(404).json({ message: "alert not found" });
		return;
	}

	res.status(200).json({ message: "alert acknowledged" });
});

export { alertsRouter };
