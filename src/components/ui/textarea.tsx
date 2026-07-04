import * as React from "react";
import { cn } from "@/lib/utils";
export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea className={cn("min-h-24 w-full rounded-lg border border-input bg-white px-3 py-3 text-sm shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring", className)} {...props} />; }
