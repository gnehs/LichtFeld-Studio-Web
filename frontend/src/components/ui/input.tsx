import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <div className={cn("relative flex w-full items-center", className)}>
      <div className="glass-panel pointer-events-none absolute inset-0 rounded-lg dark:bg-input/30" />
      <InputPrimitive
        type={type}
        data-slot="input"
        className={cn(
          "relative h-8 w-full min-w-0 rounded-lg border-0 bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"
        )}
        {...props}
      />
    </div>
  )
}

export { Input }
