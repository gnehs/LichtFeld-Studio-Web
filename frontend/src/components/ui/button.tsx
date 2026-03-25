import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl border text-[11px] font-semibold tracking-[0.18em] uppercase transition-all duration-200 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring/70 disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        default:
          "border-white/12 bg-white text-black shadow-[0_10px_24px_rgba(255,255,255,0.09)] hover:-translate-y-0.5 hover:bg-zinc-100",
        secondary:
          "border-white/10 bg-white/[0.06] text-zinc-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] hover:bg-white/[0.1]",
        outline:
          "border-white/12 bg-black/20 text-zinc-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:border-cyan-400/40 hover:bg-cyan-400/[0.08] hover:text-cyan-100",
        destructive:
          "border-red-500/30 bg-red-500/14 text-red-100 hover:bg-red-500/22"
      },
      size: {
        default: "h-9 px-4",
        sm: "h-8 rounded-lg px-3 text-[10px]",
        lg: "h-10 rounded-xl px-6"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
});
Button.displayName = "Button";

export { Button, buttonVariants };
