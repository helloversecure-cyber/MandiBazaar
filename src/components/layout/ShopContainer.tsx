import { cn } from "@/lib/utils";

type Width = "sm" | "md" | "lg" | "xl" | "full";

const widths: Record<Width, string> = {
  sm: "max-w-3xl",
  md: "max-w-5xl",
  lg: "max-w-6xl",
  xl: "max-w-7xl",
  full: "max-w-[1400px]",
};

export function ShopContainer({
  children,
  width = "xl",
  className,
  noPadding,
}: {
  children: React.ReactNode;
  width?: Width;
  className?: string;
  noPadding?: boolean;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full",
        widths[width],
        !noPadding && "px-4 py-6 lg:px-6 lg:py-8",
        className
      )}
    >
      {children}
    </div>
  );
}
