import { Badge } from "@/components/ui/Badge";
import { Card, CardContent } from "@/components/ui/Card";
import ProfileCard from "./components/ProfileCard";
import PositionsCard from "./components/PositionsCard";
import TabsContainer from "./components/TabsContainer";
import ResetDataButton from "./components/ResetDataButton";
import { Suspense } from "react";

export default function PortfolioTrackerPage() {
  // Parent server component – renders client subcomponents
  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <header className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Personal Portfolio Tracker</h1>
            <p className="text-gray-600">
              Educational portfolio analysis & AI-powered insights. Not financial advice.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <ResetDataButton />
            <Badge>Beta</Badge>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left column: Inputs */}
        <div className="space-y-6">
          <Suspense fallback={<Card><CardContent>Loading profile…</CardContent></Card>}>
            {/* @ts-expect-error Async Server Component boundary */}
            <ProfileCard />
          </Suspense>
          <Suspense fallback={<Card><CardContent>Loading positions…</CardContent></Card>}>
            {/* @ts-expect-error Async Server Component boundary */}
            <PositionsCard />
          </Suspense>
        </div>

        {/* Right column: Analytics & AI */}
        <div>
          <TabsContainer />
        </div>
      </div>

      <footer className="mt-10">
        <Card>
          <CardContent>
            <p className="text-sm text-gray-700">
              This tool is for educational and informational purposes only and does not constitute financial,
              investment, or tax advice. It does not execute trades or connect to brokerage accounts. Always do your
              own research or consult a licensed financial professional before making investment decisions.
            </p>
          </CardContent>
        </Card>
      </footer>
    </main>
  );
}

