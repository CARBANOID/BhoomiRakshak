import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import type { StringValue } from "ms";
import { prismaClient } from "../lib/prisma.js";
import { zodSignInSchema, zodSignUpSchema } from "../zodSchema.js";

const authRouter = Router();
const saltRounds = 10;

authRouter.post("/signup", async (req, res) => {
	const result = await zodSignUpSchema.safeParseAsync(req.body);
	if (!result.success) {
		res.status(411).json({ message: result.error.message });
		return;
	}

	const { username, password, email } = result.data;
	const hashedPassword = await bcrypt.hash(password, saltRounds);

	try {
		await prismaClient.user.create({
			data: {
				username,
				email,
				password: hashedPassword
			}
		});

		res.status(200).json({ message: "sign up successfull" });
	} catch {
		res.status(411).json({ message: "user with this email already exists" });
	}
});

authRouter.post("/signin", async (req, res) => {
	const result = await zodSignInSchema.safeParseAsync(req.body);
	if (!result.success) {
		res.status(411).json({ message: "wrong username or password!" });
		return;
	}

	const { email, password } = result.data;
	const user = await prismaClient.user.findFirst({ where: { email } });

	if (!user) {
		res.status(402).json({ message: "You are not Signed Up!", signup: false });
		return;
	}

	const passVerify = await bcrypt.compare(password, user.password);
	if (!passVerify) {
		res.status(411).json({ message: "wrong email or password!" });
		return;
	}

	const token = jwt.sign(
		{ userId: user.id },
		process.env.JWT_SECRET as string,
		{ expiresIn: (process.env.JWT_EXPIRE_TIME as StringValue) ?? "4h" }
	);

	res.setHeader("token", token);
	res.status(200).json({
		token,
		username: user.username,
		message: "sign in successfull"
	});
});

export { authRouter };
