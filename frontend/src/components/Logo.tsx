import React from "react";

interface LogoProps {
  className?: string;
  size?: number;
}

export const Logo: React.FC<LogoProps> = ({ className = "w-8 h-8", size = 32 }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      fill="none"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="8" fill="#18181b" />
      <rect x="0.5" y="0.5" width="31" height="31" rx="7.5" stroke="#27272a" />
      {/* Pipeline track */}
      <path d="M7 16h18" stroke="#3f3f46" strokeWidth="2" strokeLinecap="round" />
      {/* Baseline node */}
      <circle cx="9" cy="16" r="3" fill="#10b981" stroke="#18181b" strokeWidth="1.5" />
      {/* Divergence node */}
      <circle cx="16" cy="16" r="3" fill="#f59e0b" stroke="#18181b" strokeWidth="1.5" />
      {/* Target node */}
      <circle cx="23" cy="16" r="3" fill="#ef4444" stroke="#18181b" strokeWidth="1.5" />
      {/* Rewind trace arc */}
      <path d="M21 11a7 7 0 0 0-10 0" stroke="#10b981" strokeWidth="1.8" strokeLinecap="round" />
      <polygon points="10,8 10,13 6,10.5" fill="#10b981" />
    </svg>
  );
};
