"use client";

import { useEffect } from "react";

export default function Toast({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-50">
      <div className="pointer-events-auto rounded-md bg-neutral-800 px-4 py-2 text-sm text-neutral-100 shadow-lg ring-1 ring-neutral-700">
        {message}
      </div>
    </div>
  );
}
