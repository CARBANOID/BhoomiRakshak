import { RunStatus } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { Router } from "express";
import { authMiddleWare } from "../auth.js";
import { notifyRunQueued } from "../lib/monitoringRunQueue.js";
import { prismaClient } from "../lib/prisma.js";
import { zodCreateMonitoringRunSchema, zodCreateScheduleSchema } from "../zodSchema.js";

const monitoringRouter = Router();

const runStatusValues = new Set(Object.values(RunStatus));

monitoringRouter.post("/monitoring/runs", authMiddleWare, async (req, res) => {
	const parsed = await zodCreateMonitoringRunSchema.safeParseAsync(req.body);
	if (!parsed.success) {
		res.status(411).json({ message: parsed.error.message });
		return;
	}

	const userId = req.userId;
	if (!userId) {
		res.status(403).json({ message: "unauthorized access !! please sign in first !", logout: true });
		return;
	}

	const { aoiId, runDate, baselineMode, baselineYears, baselineLagYears, thresholdProfileId, configOverrides } = parsed.data;

	const aoi = await prismaClient.aoi.findFirst({
		where: {
			id: aoiId,
			userId,
			isDeleted: false
		}
	});

	if (!aoi) {
		res.status(404).json({ message: "aoi not found" });
		return;
	}

	const runData: Prisma.MonitoringRunUncheckedCreateInput = {
		userId,
		aoiId,
		status: RunStatus.queued,
		runDate: runDate ? new Date(runDate) : new Date(),
		baselineMode: baselineMode ?? null,
		baselineYears: baselineYears ?? null,
		baselineLagYears: baselineLagYears ?? null,
		thresholdProfileId: thresholdProfileId ?? null
	};

	if (typeof configOverrides !== "undefined") {
		runData.configSnapshot = configOverrides as Prisma.InputJsonValue;
	}

	const run = await prismaClient.monitoringRun.create({
		data: runData
	});

	notifyRunQueued();

	res.status(202).json({
		message: "monitoring run queued",
		runId: run.id,
		status: run.status
	});
});

monitoringRouter.get("/monitoring/runs/:runId", authMiddleWare, async (req, res) => {
	const userId = req.userId;
	if (!userId) {
		res.status(403).json({ message: "unauthorized access !! please sign in first !", logout: true });
		return;
	}

	const runId = req.params.runId;
	if (!runId) {
		res.status(400).json({ message: "runId is required" });
		return;
	}

	const run = await prismaClient.monitoringRun.findFirst({
		where: {
			id: runId,
			userId
		},
		include: {
			threatMetrics: true,
			report: true
		}
	});

	if (!run) {
		res.status(404).json({ message: "run not found" });
		return;
	}

	res.status(200).json({ run });
});

monitoringRouter.get("/monitoring/runs", authMiddleWare, async (req, res) => {
	const userId = req.userId;
	if (!userId) {
		res.status(403).json({ message: "unauthorized access !! please sign in first !", logout: true });
		return;
	}

	const { aoiId, status, from, to, thresholdProfileId, page = "1", limit = "50", sort = "desc" } = req.query;

	const where: {
		userId: string;
		aoiId?: string;
		status?: RunStatus;
		thresholdProfileId?: string;
		createdAt?: {
			gte?: Date;
			lte?: Date;
		};
	} = { userId };

	if (typeof aoiId === "string" && aoiId.length > 0) {
		where.aoiId = aoiId;
	}

	if (typeof status === "string" && runStatusValues.has(status as RunStatus)) {
		where.status = status as RunStatus;
	}

	if (typeof thresholdProfileId === "string" && thresholdProfileId.length > 0) {
		where.thresholdProfileId = thresholdProfileId;
	}

	if (typeof from === "string" || typeof to === "string") {
		where.createdAt = {};
		if (typeof from === "string") {
			const fromDate = new Date(from);
			if (Number.isNaN(fromDate.getTime())) {
				res.status(400).json({ message: "from must be a valid ISO datetime" });
				return;
			}
			where.createdAt.gte = fromDate;
		}
		if (typeof to === "string") {
			const toDate = new Date(to);
			if (Number.isNaN(toDate.getTime())) {
				res.status(400).json({ message: "to must be a valid ISO datetime" });
				return;
			}
			where.createdAt.lte = toDate;
		}
	}

	const parsedPage = Number.parseInt(typeof page === "string" ? page : "1", 10);
	const parsedLimit = Number.parseInt(typeof limit === "string" ? limit : "50", 10);
	if (!Number.isFinite(parsedPage) || parsedPage < 1) {
		res.status(400).json({ message: "page must be a positive integer" });
		return;
	}
	if (!Number.isFinite(parsedLimit) || parsedLimit < 1 || parsedLimit > 200) {
		res.status(400).json({ message: "limit must be an integer between 1 and 200" });
		return;
	}

	const sortDirection = typeof sort === "string" && sort.toLowerCase() === "asc" ? "asc" : "desc";
	const skip = (parsedPage - 1) * parsedLimit;

	const [runs, total] = await Promise.all([
		prismaClient.monitoringRun.findMany({
			where,
			orderBy: { createdAt: sortDirection },
			skip,
			take: parsedLimit,
			include: {
				aoi: {
					select: {
						id: true,
						name: true,
						sourceType: true
					}
				},
				thresholdProfile: {
					select: {
						id: true,
						name: true,
						mode: true,
						isDefault: true
					}
				}
			}
		}),
		prismaClient.monitoringRun.count({ where })
	]);

	res.status(200).json({
		runs,
		pagination: {
			page: parsedPage,
			limit: parsedLimit,
			total,
			totalPages: Math.max(1, Math.ceil(total / parsedLimit)),
			sort: sortDirection
		}
	});
});

monitoringRouter.post("/monitoring/runs/:runId/cancel", authMiddleWare, async (req, res) => {
	const userId = req.userId;
	if (!userId) {
		res.status(403).json({ message: "unauthorized access !! please sign in first !", logout: true });
		return;
	}

	const runId = req.params.runId;
	if (!runId) {
		res.status(400).json({ message: "runId is required" });
		return;
	}

	const cancelled = await prismaClient.monitoringRun.updateMany({
		where: {
			id: runId,
			userId,
			status: RunStatus.queued
		},
		data: {
			status: RunStatus.cancelled,
			completedAt: new Date(),
			errorMessage: "cancelled by user"
		}
	});

	if (cancelled.count > 0) {
		res.status(200).json({ message: "run cancelled", runId });
		return;
	}

	const run = await prismaClient.monitoringRun.findFirst({
		where: {
			id: runId,
			userId
		},
		select: {
			status: true
		}
	});

	if (!run) {
		res.status(404).json({ message: "run not found" });
		return;
	}

	if (run.status === RunStatus.running) {
		res.status(409).json({
			message: "run is already running and cannot be cancelled safely in current implementation"
		});
		return;
	}

	res.status(409).json({ message: `run cannot be cancelled from status ${run.status}` });
});

monitoringRouter.post("/monitoring/runs/:runId/retry", authMiddleWare, async (req, res) => {
	const userId = req.userId;
	if (!userId) {
		res.status(403).json({ message: "unauthorized access !! please sign in first !", logout: true });
		return;
	}

	const runId = req.params.runId;
	if (!runId) {
		res.status(400).json({ message: "runId is required" });
		return;
	}

	const existingRun = await prismaClient.monitoringRun.findFirst({
		where: {
			id: runId,
			userId
		}
	});

	if (!existingRun) {
		res.status(404).json({ message: "run not found" });
		return;
	}

	if (existingRun.status !== RunStatus.failed && existingRun.status !== RunStatus.cancelled) {
		res.status(409).json({
			message: "only failed or cancelled runs can be retried"
		});
		return;
	}

	const retryData: Prisma.MonitoringRunUncheckedCreateInput = {
		userId: existingRun.userId,
		aoiId: existingRun.aoiId,
		status: RunStatus.queued,
		runDate: new Date(),
		baselineMode: existingRun.baselineMode,
		baselineYears: existingRun.baselineYears,
		baselineLagYears: existingRun.baselineLagYears,
		thresholdProfileId: existingRun.thresholdProfileId
	};

	if (typeof existingRun.configSnapshot !== "undefined" && existingRun.configSnapshot !== null) {
		retryData.configSnapshot = existingRun.configSnapshot as Prisma.InputJsonValue;
	}

	const retriedRun = await prismaClient.monitoringRun.create({
		data: retryData
	});

	notifyRunQueued();

	res.status(202).json({
		message: "retry run queued",
		runId: retriedRun.id,
		status: retriedRun.status,
		retryOfRunId: existingRun.id
	});
});

monitoringRouter.get("/monitoring/schedules", authMiddleWare, async (req, res) => {
	const userId = req.userId;
	if (!userId) {
		res.status(403).json({ message: "unauthorized access !! please sign in first !", logout: true });
		return;
	}

	const { aoiId, isActive, dueBefore, limit } = req.query;

	const where: Prisma.MonitoringScheduleWhereInput = {
		userId
	};

	if (typeof aoiId === "string" && aoiId.length > 0) {
		where.aoiId = aoiId;
	}

	if (typeof isActive === "string") {
		const activeToken = isActive.trim().toLowerCase();
		if (activeToken !== "true" && activeToken !== "false") {
			res.status(400).json({ message: "isActive must be true or false" });
			return;
		}
		where.isActive = activeToken === "true";
	}

	if (typeof dueBefore === "string") {
		const dueBeforeDate = new Date(dueBefore);
		if (Number.isNaN(dueBeforeDate.getTime())) {
			res.status(400).json({ message: "dueBefore must be a valid ISO datetime" });
			return;
		}
		where.nextRunAt = { lte: dueBeforeDate };
	}

	let take = 50;
	if (typeof limit === "string") {
		const parsedLimit = Number.parseInt(limit, 10);
		if (!Number.isFinite(parsedLimit) || parsedLimit < 1 || parsedLimit > 200) {
			res.status(400).json({ message: "limit must be an integer between 1 and 200" });
			return;
		}
		take = parsedLimit;
	}

	const schedules = await prismaClient.monitoringSchedule.findMany({
		where,
		orderBy: [{ nextRunAt: "asc" }, { createdAt: "desc" }],
		take,
		include: {
			aoi: {
				select: {
					id: true,
					name: true,
					sourceType: true,
					isDeleted: true
				}
			}
		}
	});

	res.status(200).json({ schedules });
});

monitoringRouter.get("/monitoring/schedules/:scheduleId", authMiddleWare, async (req, res) => {
	const userId = req.userId;
	if (!userId) {
		res.status(403).json({ message: "unauthorized access !! please sign in first !", logout: true });
		return;
	}

	const scheduleId = req.params.scheduleId;
	if (!scheduleId) {
		res.status(400).json({ message: "scheduleId is required" });
		return;
	}

	const schedule = await prismaClient.monitoringSchedule.findFirst({
		where: {
			id: scheduleId,
			userId
		},
		include: {
			aoi: {
				select: {
					id: true,
					name: true,
					sourceType: true,
					isDeleted: true
				}
			}
		}
	});

	if (!schedule) {
		res.status(404).json({ message: "schedule not found" });
		return;
	}

	res.status(200).json({ schedule });
});

monitoringRouter.post("/monitoring/schedules", authMiddleWare, async (req, res) => {
	const parsed = await zodCreateScheduleSchema.safeParseAsync(req.body);
	if (!parsed.success) {
		res.status(411).json({ message: parsed.error.message });
		return;
	}

	const userId = req.userId;
	if (!userId) {
		res.status(403).json({ message: "unauthorized access !! please sign in first !", logout: true });
		return;
	}

	const { aoiId, cadence, nextRunAt, configSnapshot } = parsed.data;
	const aoi = await prismaClient.aoi.findFirst({ where: { id: aoiId, userId, isDeleted: false } });

	if (!aoi) {
		res.status(404).json({ message: "aoi not found" });
		return;
	}

	const scheduleData: Prisma.MonitoringScheduleUncheckedCreateInput = {
		userId,
		aoiId,
		cadence,
		nextRunAt: new Date(nextRunAt)
	};

	if (typeof configSnapshot !== "undefined") {
		scheduleData.configSnapshot = configSnapshot as Prisma.InputJsonValue;
	}

	const schedule = await prismaClient.monitoringSchedule.create({
		data: scheduleData
	});

	res.status(200).json({ message: "schedule created", schedule });
});

monitoringRouter.patch("/monitoring/schedules/:scheduleId", authMiddleWare, async (req, res) => {
	const userId = req.userId;
	if (!userId) {
		res.status(403).json({ message: "unauthorized access !! please sign in first !", logout: true });
		return;
	}

	const { scheduleId } = req.params;
	if (!scheduleId) {
		res.status(400).json({ message: "scheduleId is required" });
		return;
	}

	const { isActive, nextRunAt, cadence, configSnapshot } = req.body as {
		isActive?: boolean;
		nextRunAt?: string;
		cadence?: string;
		configSnapshot?: unknown;
	};

	const updateData: Prisma.MonitoringScheduleUncheckedUpdateManyInput = {};
	if (typeof isActive !== "undefined") {
		updateData.isActive = isActive;
	}
	if (typeof nextRunAt === "string") {
		updateData.nextRunAt = new Date(nextRunAt);
	}
	if (typeof cadence === "string") {
		updateData.cadence = cadence;
	}
	if (typeof configSnapshot !== "undefined") {
		updateData.configSnapshot = configSnapshot as Prisma.InputJsonValue;
	}

	const schedule = await prismaClient.monitoringSchedule.updateMany({
		where: {
			id: scheduleId,
			userId
		},
		data: updateData
	});

	if (schedule.count === 0) {
		res.status(404).json({ message: "schedule not found" });
		return;
	}

	res.status(200).json({ message: "schedule updated" });
});

monitoringRouter.delete("/monitoring/schedules/:scheduleId", authMiddleWare, async (req, res) => {
	const userId = req.userId;
	if (!userId) {
		res.status(403).json({ message: "unauthorized access !! please sign in first !", logout: true });
		return;
	}

	const scheduleId = req.params.scheduleId;
	if (!scheduleId) {
		res.status(400).json({ message: "scheduleId is required" });
		return;
	}

	const deleted = await prismaClient.monitoringSchedule.deleteMany({
		where: {
			id: scheduleId,
			userId
		}
	});

	if (deleted.count === 0) {
		res.status(404).json({ message: "schedule not found" });
		return;
	}

	res.status(200).json({ message: "schedule deleted" });
});

export { monitoringRouter };
