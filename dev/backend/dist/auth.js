import jwt from "jsonwebtoken";
import * as dotenv from "dotenv";
dotenv.config();
export const authMiddleWare = (req, res, next) => {
    const token = req.headers["token"];
    jwt.verify(token, process.env.JWT_SECRET, (error, payload) => {
        if (error) {
            if (error instanceof jwt.TokenExpiredError) {
                // refresh the Token
                res.status(403).json({
                    message: "Token Expired !",
                    logut: true
                });
            }
            else {
                res.status(403).json({
                    message: "unauthorized access !! please sign in first !",
                    logout: true,
                });
            }
            return;
        }
        if (typeof payload == "string" || typeof payload == "undefined") {
            res.status(403).json({
                message: "incorrect payload",
                logout: true
            });
            return;
        }
        req.headers["userId"] = payload.userId;
        next();
    });
};
//# sourceMappingURL=auth.js.map