const COLORS = [
  "bg-rose-600",
  "bg-orange-600",
  "bg-amber-600",
  "bg-emerald-600",
  "bg-teal-600",
  "bg-sky-600",
  "bg-indigo-600",
  "bg-violet-600",
  "bg-fuchsia-600",
];

function colorFor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return COLORS[hash % COLORS.length];
}

function initialsFor(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const SIZES = {
  sm: "h-7 w-7 text-[11px]",
  md: "h-9 w-9 text-sm",
  lg: "h-16 w-16 text-lg",
} as const;

export default function Avatar({
  name,
  avatarUrl,
  size = "md",
  className = "",
}: {
  name: string;
  avatarUrl?: string | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const base = `flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white ${SIZES[size]} ${className}`;

  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt={name}
        className={`${base} object-cover`}
        referrerPolicy="no-referrer"
      />
    );
  }

  return <div className={`${base} ${colorFor(name || "?")}`}>{initialsFor(name || "?")}</div>;
}
