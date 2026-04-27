import { Prisma } from "@prisma/client";
import { Router } from "express";
import { authMiddleWare } from "../auth.js";
import { prismaClient } from "../lib/prisma.js";
import { zodCreateThresholdProfileSchema, zodUpdateThresholdProfileSchema } from "../zodSchema.js";

const thresholdProfilesRouter = Router();

thresholdProfilesRouter.get("/threshold-profiles", authMiddleWare, async (req, res) => {
	const userId = req.userId;
	if (!userId) {
		res.status(403).json({ message: "unauthorized access !! please sign in first !", logout: true });
		return;
	}

	const profiles = await prismaClient.thresholdProfile.findMany({
		where: { userId },
		orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }]
	});

	res.status(200).json({ profiles });
});

thresholdProfilesRouter.post("/threshold-profiles", authMiddleWare, async (req, res) => {
	const parsed = await zodCreateThresholdProfileSchema.safeParseAsync(req.body);
	if (!parsed.success) {
		res.status(411).json({ message: parsed.error.message });
		return;
	}

	const userId = req.userId;
	if (!userId) {
		res.status(403).json({ message: "unauthorized access !! please sign in first !", logout: true });
		return;
	}

	const { name, mode, config, isDefault } = parsed.data;

	try {
		const profile = await prismaClient.$transaction(async (tx) => {
			if (isDefault === true) {
				await tx.thresholdProfile.updateMany({
					where: { userId, isDefault: true },
					data: { isDefault: false }
				});
			}

			const created = await tx.thresholdProfile.create({
				data: {
					userId,
					name,
					mode: mode ?? "strict",
					config: config as Prisma.InputJsonValue,
					isDefault: isDefault ?? false
				}
			});

			if (!isDefault) {
				const existingDefaultCount = await tx.thresholdProfile.count({
					where: { userId, isDefault: true }
				});

				if (existingDefaultCount === 0) {
					return tx.thresholdProfile.update({
						where: { id: created.id },
						data: { isDefault: true }
					});
				}
			}

			return created;
		});

		res.status(200).json({ message: "threshold profile created", profile });
	} catch (error) {
		if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
			res.status(409).json({ message: "profile name already exists" });
			return;
		}
		throw error;
	}
});

thresholdProfilesRouter.patch("/threshold-profiles/:profileId", authMiddleWare, async (req, res) => {
	const parsed = await zodUpdateThresholdProfileSchema.safeParseAsync(req.body);
	if (!parsed.success) {
		res.status(411).json({ message: parsed.error.message });
		return;
	}

	const userId = req.userId;
	if (!userId) {
		res.status(403).json({ message: "unauthorized access !! please sign in first !", logout: true });
		return;
	}

	const profileId = req.params.profileId;
	if (!profileId) {
		res.status(400).json({ message: "profileId is required" });
		return;
	}

	const existing = await prismaClient.thresholdProfile.findFirst({
		where: { id: profileId, userId }
	});

	if (!existing) {
		res.status(404).json({ message: "threshold profile not found" });
		return;
	}

	const { name, mode, config, isDefault } = parsed.data;
	const updateData: Prisma.ThresholdProfileUncheckedUpdateInput = {};
	if (typeof name !== "undefined") {
		updateData.name = name;
	}
	if (typeof mode !== "undefined") {
		updateData.mode = mode;
	}
	if (typeof config !== "undefined") {
		updateData.config = config as Prisma.InputJsonValue;
	}
	if (typeof isDefault !== "undefined") {
		updateData.isDefault = isDefault;
	}

	try {
		const profile = await prismaClient.$transaction(async (tx) => {
			if (isDefault === true) {
				await tx.thresholdProfile.updateMany({
					where: { userId, isDefault: true, id: { not: profileId } },
					data: { isDefault: false }
				});
			}

			const updated = await tx.thresholdProfile.update({
				where: { id: profileId },
				data: updateData
			});

			if (isDefault === false && existing.isDefault) {
				const fallback = await tx.thresholdProfile.findFirst({
					where: { userId, id: { not: profileId } },
					orderBy: { updatedAt: "desc" }
				});

				if (fallback) {
					await tx.thresholdProfile.update({
						where: { id: fallback.id },
						data: { isDefault: true }
					});
				}
			}

			return updated;
		});

		res.status(200).json({ message: "threshold profile updated", profile });
	} catch (error) {
		if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
			res.status(409).json({ message: "profile name already exists" });
			return;
		}
		throw error;
	}
});

thresholdProfilesRouter.post("/threshold-profiles/:profileId/default", authMiddleWare, async (req, res) => {
	const userId = req.userId;
	if (!userId) {
		res.status(403).json({ message: "unauthorized access !! please sign in first !", logout: true });
		return;
	}

	const profileId = req.params.profileId;
	if (!profileId) {
		res.status(400).json({ message: "profileId is required" });
		return;
	}

	const existing = await prismaClient.thresholdProfile.findFirst({
		where: { id: profileId, userId }
	});
	if (!existing) {
		res.status(404).json({ message: "threshold profile not found" });
		return;
	}

	await prismaClient.$transaction(async (tx) => {
		await tx.thresholdProfile.updateMany({
			where: { userId, isDefault: true },
			data: { isDefault: false }
		});
		await tx.thresholdProfile.update({
			where: { id: profileId },
			data: { isDefault: true }
		});
	});

	res.status(200).json({ message: "default threshold profile updated", profileId });
});

thresholdProfilesRouter.delete("/threshold-profiles/:profileId", authMiddleWare, async (req, res) => {
	const userId = req.userId;
	if (!userId) {
		res.status(403).json({ message: "unauthorized access !! please sign in first !", logout: true });
		return;
	}

	const profileId = req.params.profileId;
	if (!profileId) {
		res.status(400).json({ message: "profileId is required" });
		return;
	}

	const existing = await prismaClient.thresholdProfile.findFirst({
		where: { id: profileId, userId }
	});
	if (!existing) {
		res.status(404).json({ message: "threshold profile not found" });
		return;
	}

	await prismaClient.$transaction(async (tx) => {
		await tx.thresholdProfile.delete({
			where: { id: profileId }
		});

		if (existing.isDefault) {
			const fallback = await tx.thresholdProfile.findFirst({
				where: { userId },
				orderBy: { updatedAt: "desc" }
			});
			if (fallback) {
				await tx.thresholdProfile.update({
					where: { id: fallback.id },
					data: { isDefault: true }
				});
			}
		}
	});

	res.status(200).json({ message: "threshold profile deleted", profileId });
});

export { thresholdProfilesRouter };
