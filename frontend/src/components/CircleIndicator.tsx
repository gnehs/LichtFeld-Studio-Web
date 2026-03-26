import { motion } from "motion/react";
export function CircleIndicator({
  progress = 100,
  color = "var(--chart-1)",
  trackColor = "var(--color-muted)",
  size = 40,
}) {
  const value = Math.max(0, Math.min(progress, 100)) / 100;
  const rounded = progress
    .toLocaleString(undefined, {
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
    })
    .replace(/^0/, "")
    .slice(0, 3)
    .replace(/\.$/, "");

  return (
    <div className="relative">
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        className="indicator"
      >
        {/* 底圈 */}
        <path
          d="M50 10 A40 40 0 1 1 50 90 A40 40 0 1 1 50 10"
          fill="none"
          stroke={trackColor}
          strokeWidth={16}
        />

        {/* 進度圈 */}
        <motion.path
          d="M50 10 A40 40 0 1 1 50 90 A40 40 0 1 1 50 10"
          fill="none"
          stroke={color}
          strokeWidth={16}
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray="1 1"
          initial={{ strokeDashoffset: 1 }}
          whileInView={{ strokeDashoffset: 1 - value }}
          viewport={{ once: true, margin: "0px 0px -72px 0px" }}
          transition={{
            duration: 0.8,
            ease: "easeOut",
          }}
        />
      </svg>
      <motion.div
        className="absolute inset-0 flex size-full items-center justify-center text-[11px] font-medium tracking-tighter tabular-nums"
        style={{
          color: `color-mix(in oklch,var(--foreground), ${color} 70%)`,
        }}
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, margin: "0px 0px -72px 0px" }}
        transition={{ duration: 0.3 }}
      >
        {rounded}
      </motion.div>
    </div>
  );
}
