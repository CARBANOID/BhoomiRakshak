import { RunStatus } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { invokeModelService } from "./modelServiceAdapter.js";
import { sendRunAlertNotification } from "./notificationDelivery.js";
import {
	buildFailureMessage,
	computeRetryDelayMs,
	inspectRetryableError,
	resolveNextRunAt
} from "./monitoringQueuePolicy.js";
import { prismaClient } from "./prisma.js";

const runInclude = {
	aoi: true,
	thresholdProfile: true
} satisfies Prisma.MonitoringRunInclude;

type QueueRun = Prisma.MonitoringRunGetPayload<{
	include: typeof runInclude;
}>;

const pollMs = Math.max(1000, Number(process.env.MONITORING_QUEUE_POLL_MS ?? 5000));
const concurrency = Math.max(1, Number(process.env.MONITORING_QUEUE_CONCURRENCY ?? 1));
const schedulePollMs = Math.max(1000, Number(process.env.MONITORING_SCHEDULE_POLL_MS ?? 30000));
const maxSchedulesPerDrain = Math.max(1, Number(process.env.MONITORING_SCHEDULE_BATCH_SIZE ?? 50));
const maxRetryCount = Math.max(0, Number(process.env.MONITORING_QUEUE_MAX_RETRIES ?? 2));
const retryBaseMs = Math.max(500, Number(process.env.MONITORING_QUEUE_RETRY_BASE_MS ?? 5000));
const retryMaxMs = Math.max(retryBaseMs, Number(process.env.MONITORING_QUEUE_RETRY_MAX_MS ?? 60000));
const retryJitterMs = Math.max(0, Number(process.env.MONITORING_QUEUE_RETRY_JITTER_MS ?? 500));

let queueTimer: NodeJS.Timeout | null = null;
let scheduleTimer: NodeJS.Timeout | null = null;
let draining = false;
let needsAnotherDrain = false;
let activeWorkers = 0;
let scheduleDraining = false;
let needsAnotherScheduleDrain = false;
const retryAttemptsByRunId = new Map<string, number>();

const queueMetrics = {
	claimed: 0,
	succeeded: 0,
	failed: 0,
	retried: 0,
	scheduleQueued: 0
};

type LogLevel = "info" | "warn" | "error";

function logQueueEvent(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
	const payload = {
		ts: new Date().toISOString(),
		component: "monitoring-queue",
		event,
		...fields
	};

	const serialized = JSON.stringify(payload);
	if (level === "warn") {
		console.warn(serialized);
		return;
	}
	if (level === "error") {
		console.error(serialized);
		return;
	}
	console.log(serialized);
}

function toJsonValue(value: unknown, fallback: Prisma.InputJsonValue): Prisma.InputJsonValue {
	if (typeof value === "undefined") {
		return fallback;
	}

	try {
		const serialized = JSON.stringify(value);
		if (typeof serialized === "undefined") {
			return fallback;
		}
		return JSON.parse(serialized) as Prisma.InputJsonValue;
	} catch {
		return fallback;
	}
}

function getAttemptForRun(runId: string): number {
	const nextAttempt = (retryAttemptsByRunId.get(runId) ?? 0) + 1;
	retryAttemptsByRunId.set(runId, nextAttempt);
	return nextAttempt;
}

function clearAttemptForRun(runId: string): void {
	retryAttemptsByRunId.delete(runId);
}

async function claimNextRun(): Promise<QueueRun | null> {
	const now = new Date();
	const candidate = await prismaClient.monitoringRun.findFirst({
		where: {
			status: RunStatus.queued,
			queuedAt: { lte: now }
		},
		orderBy: { queuedAt: "asc" },
		include: runInclude
	});

	if (!candidate) {
		return null;
	}

	const claimed = await prismaClient.monitoringRun.updateMany({
		where: {
			id: candidate.id,
			status: RunStatus.queued
		},
		data: {
			status: RunStatus.running,
			startedAt: new Date(),
			errorMessage: null
		}
	});

	if (claimed.count === 0) {
		return null;
	}

	queueMetrics.claimed += 1;
	logQueueEvent("info", "run.claimed", {
		runId: candidate.id,
		aoiId: candidate.aoiId,
		userId: candidate.userId,
		queuedAt: candidate.queuedAt.toISOString(),
		metrics: queueMetrics
	});

	return candidate;
}

async function persistRunSuccess(run: QueueRun, output: Awaited<ReturnType<typeof invokeModelService>>): Promise<void> {
	const metricRows = output.metrics.map((metric) => ({
		runId: run.id,
		threatType: metric.threatType,
		rawAreaKm2: metric.rawAreaKm2 ?? 0,
		filteredAreaKm2: metric.filteredAreaKm2 ?? metric.rawAreaKm2 ?? 0,
		percentOfAoi: metric.percentOfAoi ?? 0,
		triggered: metric.triggered ?? false,
		severity: metric.severity ?? null
	}));

	const derivedAlertRows = metricRows
		.filter((metric) => metric.triggered)
		.map((metric) => ({
			userId: run.userId,
			aoiId: run.aoiId,
			runId: run.id,
			threatType: metric.threatType,
			severity: metric.severity ?? "medium",
			areaKm2: metric.filteredAreaKm2 > 0 ? metric.filteredAreaKm2 : metric.rawAreaKm2,
			percentOfAoi: metric.percentOfAoi,
			message: null
		}));

	const adapterAlertRows = output.alerts.map((alert) => ({
		userId: run.userId,
		aoiId: run.aoiId,
		runId: run.id,
		threatType: alert.threatType,
		severity: alert.severity,
		areaKm2: alert.areaKm2 ?? 0,
		percentOfAoi: alert.percentOfAoi ?? 0,
		message: alert.message ?? null
	}));

	const finalAlertRows = adapterAlertRows.length > 0 ? adapterAlertRows : derivedAlertRows;
	
	// Fetch existing acknowledged alerts for this AOI to perform suppression
	const acknowledgedAlerts = await prismaClient.alert.findMany({
		where: {
			aoiId: run.aoiId,
			status: "acknowledged"
		},
		select: {
			threatType: true,
			areaKm2: true,
			percentOfAoi: true
		}
	});

	// Filter out alerts that haven't grown significantly since being acknowledged
	const suppressedAlertRows = finalAlertRows.filter(newAlert => {
		const existing = acknowledgedAlerts.find(a => a.threatType === newAlert.threatType);
		if (!existing) return true;
		
		// If the new threat is at least 10% larger than the acknowledged one, or covers significantly more percent
		const isMoreLethal = 
			(newAlert.areaKm2 > existing.areaKm2 * 1.1) || 
			(newAlert.percentOfAoi > existing.percentOfAoi * 1.1);
			
		return isMoreLethal;
	});

	const fallbackSummary = {
		engine: "python-model-service",
		runId: run.id,
		metricCount: metricRows.length,
		alertCount: finalAlertRows.length,
		suppressedAlertCount: finalAlertRows.length - suppressedAlertRows.length
	};

	const reportCreateData: Prisma.ReportUncheckedCreateInput = {
		runId: run.id,
		summary: toJsonValue(output.report?.summary, fallbackSummary)
	};
	const reportUpdateData: Prisma.ReportUncheckedUpdateInput = {
		summary: toJsonValue(output.report?.summary, fallbackSummary),
		generatedAt: new Date()
	};

	if (typeof output.report?.details !== "undefined") {
		const detailsJson = toJsonValue(output.report.details, {});
		reportCreateData.details = detailsJson;
		reportUpdateData.details = detailsJson;
	}

	await prismaClient.$transaction(async (tx) => {
		if (metricRows.length > 0) {
			await tx.threatMetric.createMany({ data: metricRows });
		}

		if (suppressedAlertRows.length > 0) {
			await tx.alert.createMany({ data: suppressedAlertRows });
		}

		await tx.report.upsert({
			where: { runId: run.id },
			create: reportCreateData,
			update: reportUpdateData
		});

		await tx.monitoringRun.update({
			where: { id: run.id },
			data: {
				status: RunStatus.succeeded,
				completedAt: new Date(),
				errorMessage: null
			}
		});
	});
}

async function markRunFailed(runId: string, error: unknown): Promise<void> {
	await prismaClient.monitoringRun.update({
		where: { id: runId },
		data: {
			status: RunStatus.failed,
			completedAt: new Date(),
			errorMessage: buildFailureMessage(error)
		}
	});
}

async function scheduleRunRetry(run: QueueRun, error: unknown, attempt: number): Promise<void> {
	const delayMs = computeRetryDelayMs(attempt, retryBaseMs, retryMaxMs, retryJitterMs);
	const retryAt = new Date(Date.now() + delayMs);
	const details = `retryScheduled=true; attempt=${attempt}; nextDelayMs=${delayMs}`;

	await prismaClient.monitoringRun.update({
		where: { id: run.id },
		data: {
			status: RunStatus.queued,
			queuedAt: retryAt,
			startedAt: null,
			completedAt: null,
			errorMessage: buildFailureMessage(error, details)
		}
	});

	queueMetrics.retried += 1;
	logQueueEvent("warn", "run.retry-scheduled", {
		runId: run.id,
		aoiId: run.aoiId,
		userId: run.userId,
		attempt,
		nextRetryAt: retryAt.toISOString(),
		delayMs,
		maxRetryCount,
		metrics: queueMetrics
	});
}

async function processRun(run: QueueRun): Promise<void> {
	const attempt = getAttemptForRun(run.id);
	logQueueEvent("info", "run.started", {
		runId: run.id,
		aoiId: run.aoiId,
		userId: run.userId,
		attempt
	});

	try {
		const output = await invokeModelService({
			runId: run.id,
			userId: run.userId,
			runDateIso: run.runDate.toISOString(),
			aoi: {
				id: run.aoi.id,
				name: run.aoi.name,
				geometry: run.aoi.geometry
			},
			baseline: {
				mode: run.baselineMode,
				years: run.baselineYears,
				lagYears: run.baselineLagYears
			},
			thresholdProfile: run.thresholdProfile
				? {
						id: run.thresholdProfile.id,
						name: run.thresholdProfile.name,
						mode: run.thresholdProfile.mode,
						config: run.thresholdProfile.config
				  }
				: null,
			configOverrides: run.configSnapshot
		});

		if (output.status === "failed") {
			throw new Error(output.errorMessage ?? "model service returned failed status");
		}

		await persistRunSuccess(run, output);
		await sendRunAlertNotification(run.id);
		clearAttemptForRun(run.id);
		queueMetrics.succeeded += 1;
		logQueueEvent("info", "run.succeeded", {
			runId: run.id,
			aoiId: run.aoiId,
			userId: run.userId,
			attempt,
			metricCount: output.metrics.length,
			alertCount: output.alerts.length,
			metrics: queueMetrics
		});
	} catch (error) {
		const retryInspection = inspectRetryableError(error);
		const statusCodeFields =
			typeof retryInspection.statusCode === "number" ? { statusCode: retryInspection.statusCode } : {};
		const shouldRetry = retryInspection.retryable && attempt <= maxRetryCount;

		if (shouldRetry) {
			await scheduleRunRetry(run, error, attempt);
			return;
		}

		clearAttemptForRun(run.id);
		queueMetrics.failed += 1;
		logQueueEvent("error", "run.failed", {
			runId: run.id,
			aoiId: run.aoiId,
			userId: run.userId,
			attempt,
			retryable: retryInspection.retryable,
			reason: retryInspection.reason,
			errorMessage: retryInspection.message,
			metrics: queueMetrics,
			...statusCodeFields
		});

		await markRunFailed(
			run.id,
			buildFailureMessage(
				error,
				`retryable=${retryInspection.retryable ? "true" : "false"}; reason=${retryInspection.reason}; attempt=${attempt}`
			)
		);
	}
}

async function claimAndQueueOneDueSchedule(now: Date): Promise<boolean> {
	const candidate = await prismaClient.monitoringSchedule.findFirst({
		where: {
			isActive: true,
			nextRunAt: { lte: now }
		},
		orderBy: { nextRunAt: "asc" }
	});

	if (!candidate) {
		return false;
	}

	const nextRunAt = resolveNextRunAt(candidate.nextRunAt, candidate.cadence, now);

	const queued = await prismaClient.$transaction(async (tx) => {
		const claimed = await tx.monitoringSchedule.updateMany({
			where: {
				id: candidate.id,
				isActive: true,
				nextRunAt: { lte: now }
			},
			data: {
				lastRunAt: now,
				nextRunAt
			}
		});

		if (claimed.count === 0) {
			return false;
		}

		const runData: Prisma.MonitoringRunUncheckedCreateInput = {
			userId: candidate.userId,
			aoiId: candidate.aoiId,
			status: RunStatus.queued,
			runDate: now
		};

		if (typeof candidate.configSnapshot !== "undefined" && candidate.configSnapshot !== null) {
			runData.configSnapshot = candidate.configSnapshot as Prisma.InputJsonValue;
		}

		await tx.monitoringRun.create({
			data: runData
		});

		return true;
	});

	if (queued) {
		queueMetrics.scheduleQueued += 1;
		logQueueEvent("info", "schedule.claimed-and-queued", {
			scheduleId: candidate.id,
			aoiId: candidate.aoiId,
			userId: candidate.userId,
			nextRunAt: nextRunAt.toISOString(),
			metrics: queueMetrics
		});
		notifyRunQueued();
	}

	return queued;
}

async function drainQueue(trigger: string): Promise<void> {
	if (draining) {
		needsAnotherDrain = true;
		return;
	}

	draining = true;
	try {
		while (activeWorkers < concurrency) {
			const run = await claimNextRun();
			if (!run) {
				break;
			}

			activeWorkers += 1;
			void processRun(run).finally(() => {
				activeWorkers -= 1;
				void drainQueue("worker-finished");
			});
		}
	} catch (error) {
		logQueueEvent("error", "queue.drain-error", {
			trigger,
			errorMessage: buildFailureMessage(error)
		});
	} finally {
		draining = false;
		if (needsAnotherDrain) {
			needsAnotherDrain = false;
			void drainQueue("queued-redrain");
		}
	}
}

async function drainDueSchedules(trigger: string): Promise<void> {
	if (scheduleDraining) {
		needsAnotherScheduleDrain = true;
		return;
	}

	scheduleDraining = true;
	try {
		let handled = 0;
		while (handled < maxSchedulesPerDrain) {
			const queued = await claimAndQueueOneDueSchedule(new Date());
			if (!queued) {
				break;
			}
			handled += 1;
		}
	} catch (error) {
		logQueueEvent("error", "schedule.drain-error", {
			trigger,
			errorMessage: buildFailureMessage(error)
		});
	} finally {
		scheduleDraining = false;
		if (needsAnotherScheduleDrain) {
			needsAnotherScheduleDrain = false;
			void drainDueSchedules("queued-redrain");
		}
	}
}

export function notifyRunQueued(): void {
	void drainQueue("run-queued");
}

export function startMonitoringRunQueue(): void {
	if (queueTimer) {
		return;
	}

	queueTimer = setInterval(() => {
		void drainQueue("poll");
	}, pollMs);
	scheduleTimer = setInterval(() => {
		void drainDueSchedules("poll");
	}, schedulePollMs);

	logQueueEvent("info", "queue.started", {
		pollMs,
		concurrency,
		schedulePollMs,
		maxSchedulesPerDrain,
		maxRetryCount,
		retryBaseMs,
		retryMaxMs,
		retryJitterMs
	});
	void drainQueue("startup");
	void drainDueSchedules("startup");
}

export function stopMonitoringRunQueue(): void {
	if (!queueTimer && !scheduleTimer) {
		return;
	}

	if (queueTimer) {
		clearInterval(queueTimer);
		queueTimer = null;
	}

	if (scheduleTimer) {
		clearInterval(scheduleTimer);
		scheduleTimer = null;
	}

	logQueueEvent("info", "queue.stopped", {
		metrics: queueMetrics
	});
}
