"use client";

import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Slider } from "@/components/ui/Slider";
import { Badge } from "@/components/ui/Badge";
import { usePortfolioState } from "@/lib/usePortfolioState";
import { UserProfile } from "@/lib/types";

const profileSchema = z.object({
  name: z.string().optional(),
  age: z.number().min(13, "Age must be at least 13").max(100, "Age must be under 100"),
  riskLevel: z.number().min(1).max(5),
  investmentHorizonYears: z.number().min(1).max(70),
  portfolioStartDate: z.string().optional(), // YYYY-MM-DD
  primaryGoal: z.enum(["Retirement", "House", "Wealth Building", "Education", "Short-Term Savings", "Other"]),
  goalDescription: z.string().optional(),
  monthlyContribution: z.number().min(0).optional(),
});

export default function ProfileCard() {
  const { state, setProfile } = usePortfolioState();
  const existing = state.profile ?? {
    name: "",
    age: 30,
    riskLevel: 3,
    investmentHorizonYears: 20,
    portfolioStartDate: undefined,
    primaryGoal: "Wealth Building" as const,
    goalDescription: "",
    monthlyContribution: 0,
  };
  const [form, setForm] = useState<UserProfile>(existing);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function handleSave() {
    const parsed = profileSchema.safeParse({
      ...form,
      age: Number(form.age),
      riskLevel: Number(form.riskLevel),
      investmentHorizonYears: Number(form.investmentHorizonYears),
      monthlyContribution: form.monthlyContribution ? Number(form.monthlyContribution) : undefined,
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
    setProfile(parsed.data);
  }

  const riskLabels = ["Very Conservative", "Conservative", "Moderate", "Aggressive", "Very Aggressive"];
  const riskSummary = (() => {
    const idx = Math.max(1, Math.min(5, form.riskLevel)) - 1;
    const horizon = form.investmentHorizonYears;
    if (form.riskLevel <= 2) return `${riskLabels[idx]}, ${horizon}+ year horizon`;
    if (form.riskLevel === 3) return `Moderate, ${horizon}+ year horizon`;
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
            <Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm mb-1">Age</label>
            <Input
              type="number"
              value={form.age}
              onChange={(e) => setForm({ ...form, age: Number(e.target.value) })}
            />
            {errors.age && <p className="text-xs text-red-600 mt-1">{errors.age}</p>}
          </div>
          <div className="sm:col-span-2">
            <label className="block text-sm mb-1">Risk level: {form.riskLevel} / 5</label>
            <Slider
              min={1}
              max={5}
              step={1}
              value={form.riskLevel}
              onChange={(e) => setForm({ ...form, riskLevel: Number(e.target.value) as UserProfile["riskLevel"] })}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Investment horizon (years)</label>
            <Input
              type="number"
              value={form.investmentHorizonYears}
              onChange={(e) => setForm({ ...form, investmentHorizonYears: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Portfolio start date (optional)</label>
            <Input
              type="date"
              value={form.portfolioStartDate ?? ""}
              onChange={(e) =>
                setForm({
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
                setForm({ ...form, primaryGoal: e.target.value as UserProfile["primaryGoal"] })
              }
            >
              {[
                "Retirement",
                "House",
                "Wealth Building",
                "Education",
                "Short-Term Savings",
                "Other",
              ].map((g) => (
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
                setForm({
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
              onChange={(e) => setForm({ ...form, goalDescription: e.target.value })}
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

