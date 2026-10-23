/* eslint-disable @next/next/no-img-element */
"use client";

export function BrandMark({
  className = "size-9 rounded-xl",
}: {
  className?: string;
}) {
  return (
    <img
      alt=""
      aria-hidden="true"
      className={`shrink-0 object-cover ${className}`}
      src="/icons/icon-192.png"
    />
  );
}

export function IconButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className="grid size-11 place-items-center rounded-xl text-stone-500 transition-all duration-200 hover:bg-stone-100/80 hover:text-stone-700"
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
