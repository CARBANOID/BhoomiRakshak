import { Router } from "express";
import { authMiddleWare } from "../auth.js";
import { prismaClient } from "../lib/prisma.js";
import { zodCreateShapeSchema, zodDeleteShapeSchema } from "../zodSchema.js";
const shapeRouter = Router();
shapeRouter.post("/create-shape", authMiddleWare, async (req, res) => {
    const result = await zodCreateShapeSchema.safeParseAsync(req.body);
    if (!result.success) {
        res.status(411).json({ message: result.error.message });
        return;
    }
    const userId = req.userId;
    if (!userId) {
        res.status(403).json({ message: "unauthorized access !! please sign in first !", logout: true });
        return;
    }
    const shapeCreated = await prismaClient.shape.create({
        data: {
            userId,
            shape: result.data.shape,
            alais: result.data.alais,
            type: result.data.type
        }
    });
    res.status(200).json({
        shapeId: shapeCreated.id,
        message: "shape created successfully"
    });
});
shapeRouter.post("/delete-shape", authMiddleWare, async (req, res) => {
    const result = await zodDeleteShapeSchema.safeParseAsync(req.body);
    if (!result.success) {
        res.status(411).json({ message: result.error.message });
        return;
    }
    const userId = req.userId;
    if (!userId) {
        res.status(403).json({ message: "unauthorized access !! please sign in first !", logout: true });
        return;
    }
    const deleted = await prismaClient.shape.deleteMany({
        where: {
            id: result.data.shapeId,
            userId
        }
    });
    if (deleted.count === 0) {
        res.status(404).json({ message: "shape not found" });
        return;
    }
    res.status(200).json({ message: "shape deleted successfully" });
});
shapeRouter.get("/shapes", authMiddleWare, async (req, res) => {
    const userId = req.userId;
    if (!userId) {
        res.status(403).json({ message: "unauthorized access !! please sign in first !", logout: true });
        return;
    }
    const list = await prismaClient.shape.findMany({
        where: {
            userId
        },
        orderBy: {
            updatedAt: "desc"
        }
    });
    res.status(200).json({ shapes: list });
});
export { shapeRouter };
//# sourceMappingURL=shapes.js.map