import express from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import cors from "cors";
import { authMiddleWare } from "./auth.js";
import { zodSignUpSchema, zodSignInSchema } from "./zodSchema.js";
import * as dotenv from "dotenv";
dotenv.config();
import { PrismaClient } from "@prisma/client";
const prismaClient = new PrismaClient();
const SaltRounds = 10;
const app = express();
app.use(express.json());
app.use(cors());
app.post("/bhoomi/signup", async (req, res) => {
    const result = await zodSignUpSchema.safeParseAsync(req.body);
    if (!result.success) {
        res.status(411).send({
            message: result.error.message
        });
        return;
    }
    const username = result.data.username;
    const password = result.data.password;
    const email = result.data.email;
    const hashedPassword = await bcrypt.hash(password, SaltRounds);
    try {
        await prismaClient.user.create({
            data: {
                username: username,
                password: hashedPassword,
                email: email,
            }
        });
        res.status(200).json({
            message: "sign up successfull"
        });
    }
    catch (e) {
        res.status(411).json({
            message: "user with this email already exists"
        });
    }
});
app.post("/bhoomi/signin", async (req, res) => {
    const result = await zodSignInSchema.safeParseAsync(req.body);
    if (!result.success) {
        res.status(411).send({
            message: "wrong username or password!"
        });
        return;
    }
    const email = result.data.email;
    const password = result.data.password;
    const user = await prismaClient.user.findFirst({
        where: {
            email: email,
        }
    });
    if (user == null) {
        res.status(402).send({
            message: "You are not Signed Up!",
            signup: false
        });
        return;
    }
    const passVerify = await bcrypt.compare(password, user.password); // db hashed password
    if (!passVerify) {
        res.status(411).json({
            message: "wrong email or password!"
        });
    }
    const token = jwt.sign({
        userId: user.id
    }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRE_TIME ?? "4h"
    });
    res.setHeader("token", token);
    res.status(200).json({
        token: token,
        username: user.username,
        message: "sign in successfull",
    });
});
app.post("/bhoomi/create-shape", authMiddleWare, async (req, res) => {
    const { shape, alais, type } = req.body;
    const userId = req.headers['userId'];
    const shapeCreated = await prismaClient.shape.create({
        data: {
            userId: userId,
            shape: shape,
            alais: alais,
            type: type,
        }
    });
    res.status(200).json({
        shapeId: shapeCreated.userId,
        message: "shape created successfully"
    });
});
app.post("/bhoomi/delete-shape", authMiddleWare, async (req, res) => {
    const { shapeId } = req.body;
    await prismaClient.shape.delete({
        where: {
            id: shapeId
        }
    });
    res.status(200).json({
        message: "shape deleted successfully"
    });
});
app.listen(4000);
//# sourceMappingURL=index.js.map