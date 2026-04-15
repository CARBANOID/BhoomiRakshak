import zod from "zod";
export declare const zodSignUpSchema: zod.ZodObject<{
    username: zod.ZodString;
    email: zod.ZodEmail;
    photoUrl: zod.ZodOptional<zod.ZodString>;
    password: zod.ZodString;
}, zod.z.core.$strict>;
export declare const zodSignInSchema: zod.ZodObject<{
    email: zod.ZodEmail;
    password: zod.ZodString;
}, zod.z.core.$strict>;
//# sourceMappingURL=zodSchema.d.ts.map