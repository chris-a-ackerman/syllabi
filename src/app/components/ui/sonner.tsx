"use client";

import { Toaster as Sonner, ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast: "!bg-white !border !border-black/10 !rounded-lg !shadow-[0px_4px_12px_0px_rgba(0,0,0,0.1)] !text-[#0a0a0a] !font-['Inter',sans-serif]",
          title: "!text-[13px] !font-medium !tracking-[-0.076px] !text-[#0a0a0a]",
          description: "!text-[13px] !font-normal !tracking-[-0.076px] !text-[#a1a1a1]",
          icon: "!mt-0",
          success: "[&_[data-icon]]:text-green-500",
          error: "[&_[data-icon]]:text-red-500",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
