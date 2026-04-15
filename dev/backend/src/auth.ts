import type { NextFunction , Response , Request } from "express";
import  jwt  from "jsonwebtoken"
import type { JwtPayload , VerifyErrors } from "jsonwebtoken" ;
import * as dotenv from "dotenv" ;
dotenv.config() ;

export const authMiddleWare = (req : Request,res : Response,next : NextFunction) =>{
    const token : string = req.headers["token"] as string ;
    jwt.verify(token,process.env.JWT_SECRET as string,(error : VerifyErrors | null ,payload? : JwtPayload | string ) => {
        
        if(error){
            if(error instanceof jwt.TokenExpiredError){
                // refresh the Token
                res.status(403).json({
                    message : "Token Expired !",
                    logut   : true
                })
            }
            else{
                res.status(403).json({
                    message : "unauthorized access !! please sign in first !",
                    logout : true ,
                })   
            }
            return ;
        } 

        if(typeof payload == "string" || typeof payload == "undefined"){
            res.status(403).json({
                message : "incorrect payload",
                logout : true 
            })              
            return ; 
        }

        req.headers["userId"] = payload.userId ;
        next() ; 
    })
}