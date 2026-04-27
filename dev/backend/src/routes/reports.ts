import { Router } from "express";
import PDFDocument from "pdfkit";
import { authMiddleWare } from "../auth.js";
import { prismaClient } from "../lib/prisma.js";

const reportsRouter = Router();

function serializeSummaryToLines(summary: unknown, details: unknown): string[] {
	const lines: string[] = [];

	if (summary && typeof summary === "object") {
		for (const [key, value] of Object.entries(summary)) {
			lines.push(`${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
		}
	}

	if (details && typeof details === "object") {
		lines.push("");
		lines.push("Details:");
		for (const [key, value] of Object.entries(details)) {
			lines.push(`${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
		}
	}

	if (lines.length === 0) {
		lines.push("No report content available.");
	}

	return lines;
}

reportsRouter.get("/reports", authMiddleWare, async (req, res) => {
	const userId = req.userId;
	if (!userId) {
		res.status(403).json({ message: "unauthorized access !! please sign in first !", logout: true });
		return;
	}

	const { aoiId, page = "1", limit = "20" } = req.query;
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

	const where = {
		run: {
			userId,
			...(typeof aoiId === "string" && aoiId.length > 0 ? { aoiId } : {})
		}
	};

	const skip = (parsedPage - 1) * parsedLimit;
	const [reports, total] = await Promise.all([
		prismaClient.report.findMany({
			where,
			orderBy: { generatedAt: "desc" },
			skip,
			take: parsedLimit,
			include: {
				run: {
					select: {
						id: true,
						status: true,
						runDate: true,
						aoi: {
							select: {
								id: true,
								name: true
							}
						}
					}
				}
			}
		}),
		prismaClient.report.count({ where })
	]);

	res.status(200).json({
		reports,
		pagination: {
			page: parsedPage,
			limit: parsedLimit,
			total,
			totalPages: Math.max(1, Math.ceil(total / parsedLimit))
		}
	});
});

reportsRouter.get("/reports/:runId", authMiddleWare, async (req, res) => {
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

	const report = await prismaClient.report.findFirst({
		where: {
			runId,
			run: {
				userId
			}
		}
	});

	if (!report) {
		res.status(404).json({ message: "report not found" });
		return;
	}

	res.status(200).json({ report });
});

reportsRouter.get("/reports/:runId/export", authMiddleWare, async (req, res) => {
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

	const format = typeof req.query.format === "string" ? req.query.format.toLowerCase() : "json";
	if (format !== "json" && format !== "pdf") {
		res.status(400).json({ message: "format must be either json or pdf" });
		return;
	}

	const report = await prismaClient.report.findFirst({
		where: {
			runId,
			run: {
				userId
			}
		}
	});

	if (!report) {
		res.status(404).json({ message: "report not found" });
		return;
	}

	if (format === "json") {
		res.status(200).json({
			runId,
			exportedAt: new Date().toISOString(),
			summary: report.summary,
			details: report.details
		});
		return;
	}

	const reportLines = serializeSummaryToLines(report.summary, report.details);
	const doc = new PDFDocument({ margin: 48, size: "A4" });

	res.setHeader("Content-Type", "application/pdf");
	res.setHeader("Content-Disposition", `attachment; filename=report-${runId}.pdf`);

	doc.pipe(res);
	doc.fontSize(18).text("BhoomiRakshak Monitoring Report", { align: "left" });
	doc.moveDown(0.5);
	doc.fontSize(10).fillColor("#4B5563").text(`Run ID: ${runId}`);
	doc.text(`Exported At: ${new Date().toISOString()}`);
	doc.moveDown(1);
	doc.fillColor("#111827").fontSize(12).text("Summary", { underline: true });
	doc.moveDown(0.4);

	for (const line of reportLines) {
		doc.fontSize(10).text(line, {
			width: 500,
			align: "left"
		});
	}

	doc.end();
});

export { reportsRouter };
