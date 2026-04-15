import zod from "zod"

export const zodSignUpSchema = zod.strictObject({
    username : zod.string().min(3,"username should have min 3 characters").max(30,"username can have max 30 characters"),
    email    : zod.email().max(50,"email can have max 50 characters"),
    photoUrl : zod.string().max(50,"photoUrl can have max 50 characters").optional() ,
    password : zod.string().min(8,"password should have min 8 characters").max(30,"password can have max 30 characters")
   .refine((password) => /[A-Z]/.test(password) , {message : "password should have atleast 1 uppercase letter"})    
   .refine((password) => /[a-z]/.test(password) , {message : "password should have atleast 1 lowercase letter"})
   .refine((password) => /[0-9]/.test(password) , {message : "password should have atleast 1 digit "})
   .refine((password) => /[!@#$%^&*]/.test(password) , {message : "password should have atleast 1 specialcase letter"})
})

export const zodSignInSchema = zod.strictObject({
    email    : zod.email().max(50,"email can have max 50 characters"),
    password : zod.string().min(8,"password should have min 8 characters").max(30,"password can have max 30 characters")
   .refine((password) => /[A-Z]/.test(password) , {message : "password should have atleast 1 uppercase letter"})    
   .refine((password) => /[a-z]/.test(password) , {message : "password should have atleast 1 lowercase letter"})
   .refine((password) => /[0-9]/.test(password) , {message : "password should have atleast 1 digit "})
   .refine((password) => /[!@#$%^&*]/.test(password) , {message : "password should have atleast 1 specialcase letter"})
})

