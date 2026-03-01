export function TypingBarsLoader() {
  return (
    <div
      className="inline-flex items-end gap-1 text-foreground/55"
      role="status"
      aria-label="Assistant is responding"
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-3 w-1 origin-bottom rounded-full bg-current"
          style={{
            animation: "typing-bar 0.9s ease-in-out infinite",
            animationDelay: `${i * 0.12}s`,
          }}
        />
      ))}
    </div>
  );
}
