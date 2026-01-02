"use client";

import { useState } from "react";
import { Tabs, TabPanel } from "@/components/ui/Tabs";
import OverviewTab from "./OverviewTab";
import AllocationTab from "./AllocationTab";
import GoalsTab from "./GoalsTab";
import AiAdvisorTab from "./AiAdvisorTab";
import TransactionsTab from "./TransactionsTab";
import RebalanceTab from "./RebalanceTab";

export default function TabsContainer() {
  const [tab, setTab] = useState<string>("overview");

  const tabs = [
    { value: "overview", label: "Overview" },
    { value: "allocation", label: "Allocation" },
    { value: "transactions", label: "Transactions" },
    { value: "rebalance", label: "Rebalance" },
    { value: "goals", label: "Goals" },
    { value: "advisor", label: "AI Advisor" },
  ];

  return (
    <div className="w-full">
      <Tabs tabs={tabs} value={tab} onValueChange={setTab} />

      <TabPanel when="overview" value={tab}>
        <OverviewTab />
      </TabPanel>

      <TabPanel when="allocation" value={tab}>
        <AllocationTab />
      </TabPanel>

      <TabPanel when="transactions" value={tab}>
        <TransactionsTab />
      </TabPanel>

      <TabPanel when="rebalance" value={tab}>
        <RebalanceTab />
      </TabPanel>

      <TabPanel when="goals" value={tab}>
        <GoalsTab />
      </TabPanel>

      <TabPanel when="advisor" value={tab}>
        <AiAdvisorTab />
      </TabPanel>
    </div>
  );
}
