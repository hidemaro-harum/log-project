"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type ReactNode,
} from "react";
import { ArrowLeft, CheckCircle2, CircleAlert, Info, Star } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type Message = { text: string; type: "neutral" | "success" | "error" };

export function FormShell({
  children,
  onBack,
  title,
}: {
  children: ReactNode;
  onBack: () => void;
  title: string;
}) {
  const titleId = useId();

  return (
    <section aria-labelledby={titleId} className="mx-auto max-w-6xl space-y-5">
      <div className="flex items-center gap-3">
        <button
          aria-label="戻る"
          className="grid size-11 shrink-0 place-items-center rounded-xl border border-stone-200 bg-white text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          type="button"
          onClick={onBack}
        >
          <ArrowLeft aria-hidden="true" className="size-5" />
        </button>
        <h1
          className="text-xl font-bold tracking-tight text-stone-800"
          id={titleId}
        >
          {title}
        </h1>
      </div>
      {children}
    </section>
  );
}

type FieldChildProps = {
  children?: ReactNode;
  id?: string;
  type?: string;
  required?: boolean;
};

// Some fields wrap a select or file input in layout elements. Find the actual
// control so clicking its visible label still focuses the input.
function labelFieldControl(children: ReactNode, generatedId: string) {
  let controlId: string | undefined;
  let required = false;

  function visit(nodes: ReactNode): ReactNode {
    return Children.map(nodes, (child) => {
      if (controlId || !isValidElement<FieldChildProps>(child)) return child;

      const isControl =
        child.type === Input ||
        child.type === Textarea ||
        child.type === "input" ||
        child.type === "textarea" ||
        child.type === "select";

      if (isControl && child.props.type !== "hidden") {
        controlId = child.props.id || generatedId;
        required = Boolean(child.props.required);
        return cloneElement(child, { id: controlId });
      }

      return child.props.children
        ? cloneElement(child, { children: visit(child.props.children) })
        : child;
    });
  }

  const content = visit(children);
  return { content, controlId, required };
}

export function Field({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  const generatedId = useId();
  const { content, controlId, required } = labelFieldControl(
    children,
    generatedId,
  );
  const labelClassName = "text-xs font-semibold text-stone-600";

  if (!controlId) {
    return (
      <fieldset className={cn("min-w-0 space-y-2", className)}>
        <legend className={cn("mb-2", labelClassName)}>{label}</legend>
        {content}
      </fieldset>
    );
  }

  return (
    <div className={cn("min-w-0 space-y-2", className)}>
      <Label
        className={cn("flex items-center gap-2", labelClassName)}
        htmlFor={controlId}
      >
        {label}
        {required && (
          <span className="text-[10px] font-medium text-stone-500">必須</span>
        )}
      </Label>
      {content}
    </div>
  );
}

export function MessageBanner({ message }: { message: Message }) {
  const tone =
    message.type === "error"
      ? "border-red-200 bg-red-50 text-red-800"
      : message.type === "success"
        ? "border-primary/20 bg-primary/5 text-primary"
        : "border-stone-200 bg-stone-50 text-stone-700";
  const Icon =
    message.type === "error"
      ? CircleAlert
      : message.type === "success"
        ? CheckCircle2
        : Info;

  return (
    <p
      aria-atomic="true"
      className={cn(
        "flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm font-medium leading-relaxed",
        tone,
      )}
      role={message.type === "error" ? "alert" : "status"}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{message.text}</span>
    </p>
  );
}

export function Stars({ rating }: { rating: number | null }) {
  const hasRating = rating !== null && Number.isFinite(rating);

  return (
    <span
      aria-label={hasRating ? `5点中${rating.toFixed(1)}点` : "未評価"}
      className="inline-flex items-center gap-1 text-xs font-semibold tabular-nums text-stone-600"
      role="img"
    >
      <Star
        aria-hidden="true"
        className={cn(
          "size-3.5",
          hasRating ? "fill-amber-400 text-amber-500" : "text-stone-300",
        )}
      />
      <span aria-hidden="true">{hasRating ? rating.toFixed(1) : "—"}</span>
    </span>
  );
}

export function StarPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const groupId = useId();
  const rating = Number(value) || 0;

  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50/50 px-1 py-1.5 sm:px-2">
      <div
        aria-label="評価（0.5点刻み）"
        className="grid grid-cols-5"
        role="radiogroup"
      >
        {[1, 2, 3, 4, 5].map((starValue) => {
          const fill = Math.max(0, Math.min(1, rating - starValue + 1));

          return (
            <div
              className="relative flex h-11 min-w-0 items-center justify-center"
              key={starValue}
            >
              <span
                aria-hidden="true"
                className="pointer-events-none relative block size-7"
              >
                <Star className="size-7 text-stone-300" />
                <span
                  className="absolute inset-y-0 left-0 overflow-hidden"
                  style={{ width: `${fill * 100}%` }}
                >
                  <Star className="size-7 fill-amber-400 text-amber-500" />
                </span>
              </span>
              {[starValue - 0.5, starValue].map((option, half) => (
                <label
                  className={cn(
                    "absolute inset-y-0 w-1/2 cursor-pointer",
                    half === 0 ? "left-0" : "right-0",
                  )}
                  key={option}
                >
                  <input
                    aria-label={`${option.toFixed(1)}点`}
                    checked={rating === option}
                    className="peer sr-only"
                    name={groupId}
                    type="radio"
                    value={option}
                    onChange={() => onChange(String(option))}
                  />
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 rounded-md transition-colors hover:bg-amber-400/10 peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-inset"
                  />
                </label>
              ))}
            </div>
          );
        })}
      </div>
      <div className="flex min-h-9 items-center justify-between gap-3 px-1">
        <span
          aria-live="polite"
          className="text-xs font-semibold tabular-nums text-stone-600"
        >
          {rating ? `${rating.toFixed(1)} / 5` : "未評価"}
          <span className="ml-2 font-normal text-stone-500">0.5点刻み</span>
        </span>
        <button
          aria-label="評価を解除"
          className="min-h-9 rounded-md px-2 text-xs font-medium text-stone-600 underline-offset-4 hover:text-stone-900 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"
          disabled={!rating}
          type="button"
          onClick={() => onChange("")}
        >
          解除
        </button>
      </div>
    </div>
  );
}
