import { HTMLAttributes } from "react";

type CardProps = HTMLAttributes<HTMLDivElement>;

export function Card({ className = "", children, ...props }: CardProps) {
  return (
    <div
      className={`rounded-lg border border-border bg-surface p-[var(--space-lg)] shadow-sm ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
