"use client";

import { Button } from "@/components/ui/Button";
import { STORAGE_KEY } from "@/lib/portfolioStorage";

export default function ResetDataButton() {
  function onReset() {
    try {
      localStorage.removeItem(STORAGE_KEY);
      location.reload();
    } catch {
      // ignore
    }
  }
  return (
    <Button variant="outline" onClick={onReset} title="Clear saved data and restart">
      Reset Data
    </Button>
  );
}

