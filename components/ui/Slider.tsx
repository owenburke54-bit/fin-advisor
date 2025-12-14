import * as React from "react";
import { cn } from "./cn";

export interface SliderProps extends React.InputHTMLAttributes<HTMLInputElement> {
  // range input
}

export const Slider = React.forwardRef<HTMLInputElement, SliderProps>(function Slider(
  { className, ...props },
  ref,
) {
  return (
    <input
      type="range"
      ref={ref}
      className={cn(
        "w-full h-2 rounded-lg appearance-none bg-gray-200",
        "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-black",
        "[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-black",
        className,
      )}
      {...props}
    />
  );
});

