import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-[0.18em] uppercase transition-colors focus:outline-hidden focus:ring-2 focus:ring-ring",
  {
    variants: {
      variant: {
        default: "border-cyan-400/25 bg-cyan-400/15 text-cyan-100",
        secondary: "border-amber-400/20 bg-amber-400/12 text-amber-100",
        destructive: "border-red-500/25 bg-red-500/14 text-red-100",
        outline: "border-white/12 bg-white/[0.04] text-zinc-200"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);

export interface BadgeProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
