import { cn } from "@/lib/utils";

interface BrandMarkProps {
  className?: string;
}

export function BrandMark({ className }: BrandMarkProps) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className={cn("shrink-0", className)}
      height={32}
      src="/nexus-logo.svg"
      width={32}
    />
  );
}
