import { Prisma } from "@prisma/client";
import { Router } from "express";
import { authMiddleWare } from "../auth.js";
import { prismaClient } from "../lib/prisma.js";
import { zodCreateAoiSchema, zodUpdateAoiSchema } from "../zodSchema.js";

const aoiRouter = Router();

aoiRouter.post("/aoi", authMiddleWare, async (req, res) => {
	const parsed = await zodCreateAoiSchema.safeParseAsync(req.body);
	if (!parsed.success) {
		console.error("AOI Create Zod Error:", parsed.error.format());
		res.status(411).json({ message: "invalid creation data", errors: parsed.error.format() });
		return;
	}

	const userId = req.userId;
	if (!userId) {
		res.status(403).json({ message: "unauthorized access !! please sign in first !", logout: true });
		return;
	}

	const { name, geometry, sourceType, metadata } = parsed.data;

	const created = await prismaClient.$transaction(async (tx) => {
		const aoiCreateData: Prisma.AoiUncheckedCreateInput = {
			userId,
			name,
			geometry: geometry as Prisma.InputJsonValue,
			sourceType: sourceType ?? null
		};

		if (metadata) {
			aoiCreateData.metadata = metadata as Prisma.InputJsonValue;
		}

		const aoi = await tx.aoi.create({
			data: aoiCreateData
		});

		await tx.aoiVersion.create({
			data: {
				aoiId: aoi.id,
				version: 1,
				geometry: geometry as Prisma.InputJsonValue,
				sourceType: sourceType ?? null
			}
		});

		return aoi;
	});

	res.status(200).json({
		message: "aoi created successfully",
		aoi: created
	});
});

aoiRouter.get("/aoi"	, authMiddleWare, async (req, res) => {
	const userId = req.userId;
	if (!userId) {
		res.status(403).json({ message: "unauthorized access !! please sign in first !", logout: true });
		return;
	}

	const list = await prismaClient.aoi.findMany({
		where: {
			userId,
			isDeleted: false
		},
		orderBy: {
			updatedAt: "desc"
		},
		include: {
			_count: {
				select: {
					runs: true,
					alerts: true
				}
			}
		}
	});

	res.status(200).json({ aoi: list });
});

aoiRouter.get("/aoi/:aoiId", authMiddleWare, async (req, res) => {
	const userId = req.userId;
	if (!userId) {
		res.status(403).json({ message: "unauthorized access !! please sign in first !", logout: true });
		return;
	}

	const aoiId = req.params.aoiId;
	if (!aoiId) {
		res.status(400).json({ message: "aoiId is required" });
		return;
	}

	const aoi = await prismaClient.aoi.findFirst({
		where: {
			id: aoiId,
			userId,
			isDeleted: false
		},
		include: {
			versions: {
				orderBy: {
					version: "desc"
				},
				take: 1
			}
		}
	});

	if (!aoi) {
		res.status(404).json({ message: "aoi not found" });
		return;
	}

	res.status(200).json({ aoi });
});

aoiRouter.patch("/aoi/:aoiId", authMiddleWare, async (req, res) => {
	const aoiId = req.params.aoiId;
	const userId = req.userId;
	
	if (!userId) {
		res.status(403).json({ message: "unauthorized access !! please sign in first !", logout: true });
		return;
	}

	if (!aoiId) {
		res.status(400).json({ message: "aoiId is required" });
		return;
	}

	const parsed = await zodUpdateAoiSchema.safeParseAsync(req.body);
	if (!parsed.success) {
		console.error("AOI Update Zod Error:", parsed.error.format());
		console.log("Failed Body:", JSON.stringify(req.body, null, 2));
		res.status(411).json({ message: "invalid update data", errors: parsed.error.format() });
		return;
	}

	const existing = await prismaClient.aoi.findFirst({
		where: { id: aoiId, userId, isDeleted: false }
	});

	if (!existing) {
		res.status(404).json({ message: "aoi not found" });
		return;
	}

	const { name, geometry, sourceType, metadata } = parsed.success ? parsed.data : { name: req.body.name, geometry: undefined, sourceType: undefined, metadata: undefined };

	try {
		console.log(`Updating AOI ${aoiId}:`, JSON.stringify(parsed.data, null, 2));
		const updated = await prismaClient.$transaction(async (tx) => {
			if (geometry) {
				const latest = await tx.aoiVersion.findFirst({
					where: { aoiId },
					orderBy: { version: 'desc' },
					select: { version: true }
				});

				await tx.aoiVersion.create({
					data: {
						aoiId,
						version: (latest?.version ?? 0) + 1,
						geometry: geometry as Prisma.InputJsonValue,
						sourceType: sourceType ?? existing.sourceType ?? null
					}
				});
			}

			const updateData: any = {};
			if (typeof name !== 'undefined') updateData.name = name;
			if (typeof geometry !== 'undefined') updateData.geometry = geometry as Prisma.InputJsonValue;
			if (typeof sourceType !== 'undefined') updateData.sourceType = sourceType;
			if (typeof metadata !== 'undefined') updateData.metadata = metadata as Prisma.InputJsonValue;

			return tx.aoi.update({
				where: { id: aoiId },
				data: updateData
			});
		});

		res.status(200).json({ message: "aoi updated successfully", aoi: updated });
	} catch (e) {
		console.error("AOI Update DB Error:", e);
		res.status(500).json({ message: "failed to update aoi", error: String(e) });
	}
});

aoiRouter.delete("/aoi/:aoiId", authMiddleWare, async (req, res) => {
	const userId = req.userId;
	if (!userId) {
		res.status(403).json({ message: "unauthorized access !! please sign in first !", logout: true });
		return;
	}

	const aoiId = req.params.aoiId;
	if (!aoiId) {
		res.status(400).json({ message: "aoiId is required" });
		return;
	}

	const updated = await prismaClient.aoi.updateMany({
		where: {
			id: aoiId,
			userId,
			isDeleted: false
		},
		data: {
			isDeleted: true
		}
	});

	if (updated.count === 0) {
		res.status(404).json({ message: "aoi not found" });
		return;
	}

	res.status(200).json({ message: "aoi deleted successfully" });
});

export { aoiRouter };
