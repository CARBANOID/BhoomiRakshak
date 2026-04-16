"use client"
import ky, { HTTPError } from "ky";
import { useRef, useState } from "react"
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Shield, User , Lock, Mail } from "lucide-react";
import { backendUrl } from "@/config/backendUrl";
import { toast } from "sonner"

export const AuthBox = ( { mode } : { mode : boolean}) => { // true = Sign In, false = Sign Up
    const passRef    = useRef<HTMLInputElement>(null) ; 
    const userRef    = useRef<HTMLInputElement>(null) ; 
    const mailRef    = useRef<HTMLInputElement>(null) ; 
    const [showPassword, setShowPassword] = useState(false);

    const router  = useRouter() ;

    const SignIn = async() =>{  
        if(mailRef.current!.value == "" ){
            mailRef.current!.focus() ; 
            return ;
        }
        if(passRef.current!.value == ""){
            passRef.current!.focus() ; 
            return ;
        }
        
        try {
            const response = await ky.post(`${backendUrl}/bhoomi/signin`,{
                json : {
                    password : passRef.current!.value ,
                    email    : mailRef.current!.value
                },
                throwHttpErrors: false,
            })


            const data : any = await response.json() ;
            console.log(data)

            if(response.status !== 200) {
                toast.error(data.message ?? "Sign in failed");
            }
            else {
                const username : string = data.username ; 
                const u = username.split(" ") ;
                localStorage.setItem("token",data.token) ;
                localStorage.setItem("shortname",`${u[0][0]}${u[1] ? u[1][0] : ""}`) ;
                router.push("/map")
            }
        } catch (error) {
            if (error instanceof HTTPError) {
                toast.error("Sign in failed");
                return;
            }
            toast.error("Unable to reach server");
        }
    }

    const SignUp = async() =>{
        if(mode == false && userRef.current!.value == ""){
            userRef.current!.focus() ; 
            return ;
        }   
        if(mailRef.current!.value == "" ){
            mailRef.current!.focus() ; 
            return ;
        }
        if(passRef.current!.value == ""){
            passRef.current!.focus() ; 
            return ;
        }
        
        try {
            const response = await ky.post(`${backendUrl}/bhoomi/signup`,{
                json : {
                    username : userRef.current!.value ,
                    password : passRef.current!.value ,
                    email    : mailRef.current!.value
                },
                throwHttpErrors: false,
            })

            const data : any = await response.json() ;

            if(response.status != 200) {
                toast.error(data.message ?? "Sign up failed");
            }
            else router.push("/auth/signin")
        } catch {
            toast.error("Unable to reach server");
        }
    }

    const handleSubmit = () => {
        if (mode) SignIn();
        else SignUp();
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') handleSubmit();
    };

 return (
        <div className="min-h-screen bg-linear-to-br from-green-50 via-emerald-50 to-teal-50 flex items-center justify-center p-4">
            <div className="w-full max-w-md">
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-linear-to-br from-green-600 to-emerald-600 rounded-2xl mb-4 shadow-lg">
                        <Shield className="w-9 h-9 text-white" />
                    </div>
                    <h1 className="text-3xl font-bold text-gray-900 mb-2">
                        BhoomiRakshak
                    </h1>
                    <p className="text-gray-600">
                        {mode ? "Welcome back! Sign in to continue" : "Create your account to get started"}
                    </p>
                </div>

                <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
                    <div className="space-y-5">
                        {!mode && (
                            <div className="space-y-2">
                                <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                                    <User className="w-4 h-4" />
                                    Full Name
                                </label>
                                <div className="relative">
                                    <input
                                        ref={userRef}
                                        type="text"
                                        placeholder="Enter your full name"
                                        className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                                    />
                                </div>
                            </div>
                        )}

                        {/* Email Field */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                                <Mail className="w-4 h-4" />
                                Email Address
                            </label>
                            <div className="relative">
                                <input
                                    ref={mailRef}
                                    type="email"
                                    placeholder="Enter your email"
                                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700 flex items-center gap-2">
                                <Lock className="w-4 h-4" />
                                Password
                            </label>
                            <div className="relative">
                                <input
                                    ref={passRef}
                                    type={showPassword ? "text" : "password"}
                                    placeholder="Enter your password"
                                    onKeyDown={handleKeyPress}
                                    className="w-full px-4 py-3 pr-12 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 transition-colors"
                                >
                                    {showPassword ?<EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                </button>
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={handleSubmit}
                            className="w-full bg-linear-to-r from-green-600 to-emerald-600 text-white py-3 rounded-xl font-semibold hover:from-green-700 hover:to-emerald-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-all shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            { mode ?  "Sign In"  :"Create Account"}
                        </button>

                        {/* remaining case */}
                        {mode && (
                            <div className="text-center">
                                <a
                                    href="#"
                                    className="text-sm text-green-600 hover:text-green-700 font-medium transition-colors"
                                >
                                    Forgot your password?
                                </a>
                            </div>
                        )}
                    </div>

                    <div className="mt-6 pt-6 border-t border-gray-100 text-center">
                        <p className="text-sm text-gray-600">
                            {mode ? "Don't have an account?" : "Already have an account?"}{" "}
                            <a
                                href={mode ? "/auth/signup" : "/auth/signin"}
                                className="text-green-600 hover:text-green-700 font-semibold transition-colors"
                            >
                                {mode ? "Sign Up" : "Sign In"}
                            </a>
                        </p>
                    </div>
                </div>

                <p className="text-center text-sm text-gray-500 mt-6">
                    Protected by BhoomiRakshak • Secure Land Management
                </p>
            </div>
        </div>
    );
}