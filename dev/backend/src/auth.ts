import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { JwtPayload, VerifyErrors } from "jsonwebtoken";
import * as dotenv from "dotenv";

dotenv.config();

type AuthPayload = JwtPayload & {
    userId?: string;
};

function readToken(req: Request): string | null {
    const authHeader = req.headers.authorization;
    if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        return authHeader.slice(7);
    }

    const legacyToken = req.headers["token"];
    if (typeof legacyToken === "string" && legacyToken.length > 0) {
        return legacyToken;
    }

    return null;
}

export const authMiddleWare = (req: Request, res: Response, next: NextFunction) => {
    const token = readToken(req);
    if (!token) {
        res.status(403).json({
            message: "unauthorized access !! please sign in first !",
            logout: true
        });
        return;
    }

    jwt.verify(token, process.env.JWT_SECRET as string, (error: VerifyErrors | null, payload?: JwtPayload | string) => {
        if (error) {
            if (error instanceof jwt.TokenExpiredError) {
                res.status(403).json({
                    message: "Token Expired !",
                    logout: true
                });
                return;
            }

            res.status(403).json({
                message: "unauthorized access !! please sign in first !",
                logout: true
            });
            return;
        }

        if (typeof payload === "string" || typeof payload === "undefined") {
            res.status(403).json({
                message: "incorrect payload",
                logout: true
            });
            return;
        }

        const authPayload = payload as AuthPayload;
        if (!authPayload.userId) {
            res.status(403).json({
                message: "incorrect payload",
                logout: true
            });
            return;
        }

        req.userId = authPayload.userId;
        next();
    });
};