import * as React from "react";
import { cn } from "@/lib/utils";
export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) { return <input className={cn("flex h-11 w-full rounded-lg border border-input bg-white px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring", className)} {...props} />; }
