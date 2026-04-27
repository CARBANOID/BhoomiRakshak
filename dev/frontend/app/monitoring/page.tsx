"use client";

import { DashboardSidebar } from "@/component/DashboardSidebar";
import { MonitoringPanel } from "@/component/MonitoringPanel";

export default function MonitoringPage() {
	return (
		<div className="flex min-h-screen bg-gradient-to-br from-emerald-50 via-cyan-50 to-sky-100 p-4 gap-4">
			<div className="hidden md:block shrink-0">
				<DashboardSidebar />
			</div>
			<main className="flex-1 max-w-5xl mx-auto overflow-hidden">
				<div className="mb-6">
					<p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Management</p>
					<h1 className="text-2xl font-bold text-slate-900">Monitoring & Schedules</h1>
					<p className="text-sm text-slate-500">Configure areas of interest, schedules, and view recent monitoring runs.</p>
				</div>
				
				<div className="grid grid-cols-1 gap-6">
					<div className="rounded-3xl border border-emerald-100 bg-white/90 p-2 shadow-xl backdrop-blur-sm">
						<MonitoringPanel />
					</div>
				</div>
			</main>
		</div>
	);
}
