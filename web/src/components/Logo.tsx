/**
 * The BioGuard mark: a shield with a pulse knocked out of it.
 *
 * The shield takes `currentColor`, so it inherits whatever teal the
 * surrounding wordmark is set in and cannot drift from it. The pulse is
 * white rather than a token because it is a knockout — it stands for the
 * surface behind the mark, which in this application is always white or
 * slate-50, and the difference between those two is invisible at this
 * size.
 *
 * Decorative by default. In both placements the word "BioGuard" sits
 * immediately beside it, so announcing the mark as well would read the
 * name to a screen reader twice. Pass a `label` where it ever stands
 * alone.
 */
export function Logo({ className = "", label }: { className?: string; label?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      focusable="false"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <path
        d="M32 5c0 0 12 4 18 5.5 1.5 0.4 2.5 1.7 2.5 3.3V31c0 13-9 22.5-20.5 28C20.5 53.5 11.5 44 11.5 31V13.8c0-1.6 1-2.9 2.5-3.3C20 9 32 5 32 5Z"
        fill="currentColor"
      />
      <path
        d="M19 32h6.6l3.6-8.6 5.4 16.2 3.4-7.6H45"
        fill="none"
        stroke="#ffffff"
        strokeWidth="3.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
