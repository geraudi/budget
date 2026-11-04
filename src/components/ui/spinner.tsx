import type { HugeiconsIconProps } from "@hugeicons/react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Loading03Icon } from "@hugeicons/core-free-icons"
import { cn } from "cn"

function Spinner({ className, ...props }: Omit<HugeiconsIconProps, "icon">) {
  return (
    <HugeiconsIcon
      icon={Loading03Icon}
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
