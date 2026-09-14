import * as React from "react";
import { cn } from "../../lib/utils";

// BB input treatment with the compact 32px control size.
export const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => <input ref={ref} type={type} autoComplete="off" className={cn("flex h-8 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50", className)} {...props} />,
);
Input.displayName = "Input";
