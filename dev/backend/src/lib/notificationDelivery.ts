import nodemailer from "nodemailer";
import { prismaClient } from "./prisma.js";

const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number.parseInt(process.env.SMTP_PORT ?? "587", 10);
const smtpSecure = (process.env.SMTP_SECURE ?? "false").toLowerCase() === "true";
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const smtpFrom = process.env.SMTP_FROM ?? "no-reply@bhoomirakshak.local";

const emailRetryCount = Math.max(1, Number.parseInt(process.env.NOTIFICATION_EMAIL_RETRY_COUNT ?? "3", 10));
const emailRetryBaseMs = Math.max(250, Number.parseInt(process.env.NOTIFICATION_EMAIL_RETRY_BASE_MS ?? "500", 10));

let transport: nodemailer.Transporter | null = null;

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function parseSeverityRank(severity: string): number {
	switch (severity.toLowerCase()) {
		case "critical":
			return 3;
		case "high":
			return 2;
		case "medium":
			return 1;
		default:
			return 0;
	}
}

function getTransport(): nodemailer.Transporter {
	if (transport) {
		return transport;
	}

	if (smtpHost && smtpUser && smtpPass) {
		transport = nodemailer.createTransport({
			host: smtpHost,
			port: smtpPort,
			secure: smtpSecure,
			auth: {
				user: smtpUser,
				pass: smtpPass
			}
		});
		return transport;
	}

	transport = nodemailer.createTransport({ jsonTransport: true });
	return transport;
}

export function selectAlertsForPreference<T extends { severity: string }>(alerts: T[], criticalOnly: boolean): T[] {
	if (!criticalOnly) {
		return alerts;
	}
	return alerts.filter((alert) => parseSeverityRank(alert.severity) >= 2);
}

export async function sendRunAlertNotification(runId: string): Promise<void> {
	const run = await prismaClient.monitoringRun.findUnique({
		where: { id: runId },
		include: {
			aoi: {
				select: {
					name: true
				}
			},
			user: {
				select: {
					email: true,
					username: true
				}
			},
			alerts: {
				orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
				select: {
					threatType: true,
					severity: true,
					areaKm2: true,
					percentOfAoi: true,
					message: true
				}
			}
		}
	});

	if (!run || run.alerts.length === 0) {
		return;
	}

	const preference = await prismaClient.notificationPreference.findUnique({
		where: { userId: run.userId }
	});

	const emailEnabled = preference?.emailEnabled ?? true;
	const criticalOnly = preference?.criticalOnly ?? false;
	if (!emailEnabled) {
		return;
	}

	const selectedAlerts = selectAlertsForPreference(run.alerts, criticalOnly);
	if (selectedAlerts.length === 0) {
		return;
	}

	const subject = `BhoomiRakshak Alert Summary: ${selectedAlerts.length} alert(s) for ${run.aoi.name}`;
	const intro = `Hello ${run.user.username},\n\n`;
	const lines = selectedAlerts.map((alert, index) => {
		return `${index + 1}. ${alert.threatType} | severity=${alert.severity} | area=${alert.areaKm2.toFixed(3)} km2 | pct=${alert.percentOfAoi.toFixed(2)}%${alert.message ? ` | note=${alert.message}` : ""}`;
	});
	const body = `${intro}A monitoring run has produced actionable alerts for AOI \"${run.aoi.name}\".\n\n${lines.join("\n")}\n\nRun ID: ${run.id}\nTimestamp: ${new Date().toISOString()}\n\n- BhoomiRakshak`;

	const audit = await prismaClient.notificationMessageAudit.create({
		data: {
			userId: run.userId,
			channel: "email",
			category: "alert",
			target: run.user.email,
			subject,
			body,
			status: "queued",
			metadata: {
				runId,
				alertCount: selectedAlerts.length,
				criticalOnly,
				transportMode: smtpHost ? "smtp" : "json"
			}
		}
	});

	const transporter = getTransport();
	let lastErrorMessage = "";
	for (let attempt = 1; attempt <= emailRetryCount; attempt += 1) {
		try {
			const info = await transporter.sendMail({
				from: smtpFrom,
				to: run.user.email,
				subject,
				text: body
			});

			await prismaClient.notificationMessageAudit.update({
				where: { id: audit.id },
				data: {
					status: "sent",
					attemptedAt: new Date(),
					deliveredAt: new Date(),
					errorMessage: null,
					metadata: {
						runId,
						alertCount: selectedAlerts.length,
						criticalOnly,
						attempt,
						messageId: info.messageId,
						transportMode: smtpHost ? "smtp" : "json"
					}
				}
			});
			return;
		} catch (error) {
			lastErrorMessage = error instanceof Error ? error.message : "unknown email delivery error";
			if (attempt < emailRetryCount) {
				await wait(emailRetryBaseMs * attempt);
			}
		}
	}

	await prismaClient.notificationMessageAudit.update({
		where: { id: audit.id },
		data: {
			status: "failed",
			attemptedAt: new Date(),
			errorMessage: lastErrorMessage
		}
	});
}
