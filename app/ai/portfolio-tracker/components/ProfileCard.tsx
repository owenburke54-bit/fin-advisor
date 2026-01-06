"use client";

import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Slider } from "@/components/ui/Slider";
import { Badge } from "@/components/ui/Badge";
import { usePortfolioState } from "@/lib/usePortfolioState";
import { UserProfile } from "@/lib/types";

// Typed 1–5 so TS knows riskLevel is not just "number"
const riskNumbers = [1, 2, 3, 4, 5] as const;
type RiskNumber = (typeof riskNumbers)[number];

const profileSchema = z.object({
  name: z.string().optional(),
  age: z.number().min(13, "Age must be at least 13").max(100, "Age must be under 100"),
  riskLevel: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  investmentHorizonYears: z.number().min(1).max(70),
  portfolioStartDate: z.string().optional(), // YYYY-MM-DD
  primaryGoal: z.enum(["Retirement", "House", "Wealth Building", "Education", "Short-Term Savings", "Other"]),
  goalDescription: z.string().optional(),
  monthlyContribution: z.number().min(0).optional(),
});

function clampRisk(n: number): RiskNumber {
  const v = Math.round(Number(n));
  if (v <= 1) return 1;
  if (v >= 5) return 5;
  return v as RiskNumber;
}

const DEFAULT_PROFILE: UserProfile = {
  name: "",
  age: 30,
  riskLevel: 3 as UserProfile["riskLevel"],
  investmentHorizonYears: 20,
  portfolioStartDate: undefined,
  primaryGoal: "Wealth Building",
  goalDescription: "",
  monthlyContribution: 0,
};

export default function ProfileCard() {
  const { state, setProfile } = usePortfolioState();

  // "source of truth" profile coming from persisted state (or defaults)
  const existing = useMemo<UserProfile>(() => {
    return state.profile ?? DEFAULT_PROFILE;
  }, [state.profile]);

  // Local draft form state
  const [form, setForm] = useState<UserProfile>(existing);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  // ✅ Re-hydrate form after localStorage state loads.
  // Guard with "dirty" so we don't clobber edits-in-progress.
  useEffect(() => {
    if (dirty) return;
    setForm(existing);
    // clear any stale errors when we hydrate
    setErrors({});
  }, [existing, dirty]);

  function updateForm(next: UserProfile) {
    setDirty(true);
    setForm(next);
  }

  function handleSave() {
    const parsed = profileSchema.safeParse({
      ...form,
      age: Number(form.age),
      riskLevel: clampRisk(Number(form.riskLevel)),
      investmentHorizonYears: Number(form.investmentHorizonYears),
      monthlyContribution:
        form.monthlyContribution === undefined || form.monthlyContribution === null
          ? undefined
          : Number(form.monthlyContribution),
    });

    if (!parsed.success) {
      const e: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.join(".") || "form";
        e[path] = issue.message;
      }
      setErrors(e);
      return;
    }

    setErrors({});

    const nextProfile: UserProfile = {
      ...(parsed.data as Omit<UserProfile, "riskLevel">),
      riskLevel: parsed.data.riskLevel as UserProfile["riskLevel"],
    } as UserProfile;

    setProfile(nextProfile);

    // once saved, we can treat local draft as "clean"
    setDirty(false);
  }

  const riskLabels = ["Very Conservative", "Conservative", "Moderate", "Aggressive", "Very Aggressive"] as const;

  const riskSummary = (() => {
    const idx = Math.max(1, Math.min(5, Number(form.riskLevel))) - 1;
    const horizon = Number(form.investmentHorizonYears);
    return `${riskLabels[idx]}, ${horizon}+ year horizon`;
  })();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Tell us about yourself to tailor education.</CardDescription>
          </div>
          <Badge variant="secondary">Required</Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm mb-1">Name</label>
            <Input
              value={form.name ?? ""}
              onChange={(e) => updateForm({ ...form, name: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm mb-1">Age</label>
            <Input
              type="number"
              value={form.age}
              onChange={(e) => updateForm({ ...form, age: Number(e.target.value) })}
            />
            {errors.age && <p className="text-xs text-red-600 mt-1">{errors.age}</p>}
          </div>

          <div className="sm:col-span-2">
            <label className="block text-sm mb-1">Risk level: {Number(form.riskLevel)} / 5</label>
            <Slider
              min={1}
              max={5}
              step={1}
              value={Number(form.riskLevel)}
              onChange={(e) =>
                updateForm({
                  ...form,
                  riskLevel: clampRisk(Number((e as any).target?.value ?? e)) as UserProfile["riskLevel"],
                })
              }
            />
          </div>

          <div>
            <label className="block text-sm mb-1">Investment horizon (years)</label>
            <Input
              type="number"
              value={form.investmentHorizonYears}
              onChange={(e) => updateForm({ ...form, investmentHorizonYears: Number(e.target.value) })}
            />
          </div>

          <div>
            <label className="block text-sm mb-1">Portfolio start date (optional)</label>
            <Input
              type="date"
              value={form.portfolioStartDate ?? ""}
              onChange={(e) =>
                updateForm({
                  ...form,
                  portfolioStartDate: e.target.value || undefined,
                })
              }
            />
          </div>

          <div>
            <label className="block text-sm mb-1">Primary goal</label>
            <Select
              value={form.primaryGoal}
              onChange={(e) =>
                updateForm({ ...form, primaryGoal: e.target.value as UserProfile["primaryGoal"] })
              }
            >
              {["Retirement", "House", "Wealth Building", "Education", "Short-Term Savings", "Other"].map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </Select>
          </div>

          <div className="sm:col-span-2">
            <label className="block text-sm mb-1">Monthly contribution (optional)</label>
            <Input
              type="number"
              value={form.monthlyContribution ?? 0}
              onChange={(e) =>
                updateForm({
                  ...form,
                  monthlyContribution: Number(e.target.value),
                })
              }
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block text-sm mb-1">Goal description (optional)</label>
            <Input
              value={form.goalDescription ?? ""}
              onChange={(e) => updateForm({ ...form, goalDescription: e.target.value })}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-gray-600">Risk Profile Summary: {riskSummary}</p>
          <Button onClick={handleSave}>Save Profile</Button>
        </div>
      </CardContent>
    </Card>
  );
}
