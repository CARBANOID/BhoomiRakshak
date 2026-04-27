"use client";

import { DashboardSidebar } from "@/component/DashboardSidebar";
import { backendUrl } from "@/config/backendUrl";
import { CheckCheck, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type AlertItem = {
	id: string;
	aoiId: string;
	runId: string | null;
	threatType: string;
	severity: string;
	areaKm2: number;
	percentOfAoi: number;
	status: "active" | "acknowledged" | "resolved";
	message: string | null;
	readAt: string | null;
	acknowledgedAt: string | null;
	resolvedAt: string | null;
	createdAt: string;
};

function getToken(): string | null {
	if (typeof window === "undefined") {
		return null;
	}
	return window.localStorage.getItem("token");
}

export default function AlertsPage() {
	const [token, setToken] = useState<string | null>(null);
	const [alerts, setAlerts] = useState<AlertItem[]>([]);
	const [statusFilter, setStatusFilter] = useState<string>("active");
	const [severityFilter, setSeverityFilter] = useState<string>("");
	const [isLoading, setIsLoading] = useState(false);
	const [errorMessage, setErrorMessage] = useState("");

	useEffect(() => {
		setToken(getToken());
	}, []);

	const authedFetch = useCallback(
		async <T,>(path: string, init?: RequestInit): Promise<T> => {
			if (!token) {
				throw new Error("Sign in first to view alerts.");
			}

			const response = await fetch(`${backendUrl}/bhoomi${path}`, {
				...init,
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`
				}
			});
			const payload = await response.json();
			if (!response.ok) {
				throw new Error(payload.message ?? `Request failed (${response.status})`);
			}
			return payload as T;
		},
		[token]
	);

	const loadAlerts = useCallback(async () => {
		if (!token) {
			return;
		}
		setErrorMessage("");
		setIsLoading(true);
		try {
			const params = new URLSearchParams();
			if (statusFilter) {
				params.set("status", statusFilter);
			}
			if (severityFilter) {
				params.set("severity", severityFilter);
			}
			const query = params.toString();
			const data = await authedFetch<{ alerts: AlertItem[] }>(`/alerts${query ? `?${query}` : ""}`);
			setAlerts(data.alerts);
		} catch (error) {
			setErrorMessage(error instanceof Error ? error.message : "Unable to load alerts.");
		} finally {
			setIsLoading(false);
		}
	}, [authedFetch, severityFilter, statusFilter, token]);

	useEffect(() => {
		void loadAlerts();
	}, [loadAlerts]);

	const markRead = useCallback(
		async (alertId: string) => {
			await authedFetch(`/alerts/${alertId}/read`, { method: "PATCH" });
			await loadAlerts();
		},
		[authedFetch, loadAlerts]
	);

	const acknowledgeAlert = useCallback(
		async (alertId: string) => {
			await authedFetch(`/alerts/${alertId}/acknowledge`, { method: "PATCH" });
			await loadAlerts();
		},
		[authedFetch, loadAlerts]
	);

	const resolveAlert = useCallback(
		async (alertId: string) => {
			await authedFetch(`/alerts/${alertId}/resolve`, { method: "PATCH" });
			await loadAlerts();
		},
		[authedFetch, loadAlerts]
	);

	const activeCount = useMemo(() => alerts.filter((item) => item.status === "active").length, [alerts]);

	const statusClass = (status: AlertItem["status"]) => {
		switch (status) {
			case "active":
				return "bg-rose-100 text-rose-700";
			case "acknowledged":
				return "bg-amber-100 text-amber-700";
			case "resolved":
				return "bg-emerald-100 text-emerald-700";
			default:
				return "bg-slate-100 text-slate-700";
		}
	};

	return (
		<div className="flex min-h-screen bg-gradient-to-br from-emerald-50 via-cyan-50 to-sky-100 p-4 gap-4">
			<div className="hidden md:block shrink-0">
				<DashboardSidebar />
			</div>
			<main className="flex-1 max-w-5xl mx-auto rounded-3xl border border-emerald-100 bg-white/90 p-6 shadow-xl backdrop-blur-sm">
				<div className="mb-4 flex flex-wrap items-center justify-between gap-2">
					<div>
						<p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Monitoring</p>
						<h1 className="text-2xl font-bold text-slate-900">Alerts Dashboard</h1>
						<p className="text-sm text-slate-500">{activeCount} active alerts in current view</p>
					</div>
					<button
						type="button"
						onClick={() => void loadAlerts()}
						disabled={isLoading}
						className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
					>
						<RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
						Reload
					</button>
				</div>

				<div className="mb-4 grid grid-cols-1 gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-3">
					<select
						value={statusFilter}
						onChange={(event) => setStatusFilter(event.target.value)}
						className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
					>
						<option value="">All statuses</option>
						<option value="active">active</option>
						<option value="acknowledged">acknowledged</option>
						<option value="resolved">resolved</option>
					</select>
					<input
						value={severityFilter}
						onChange={(event) => setSeverityFilter(event.target.value)}
						placeholder="Severity (high, medium...)"
						className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
					/>
					<button
						type="button"
						onClick={() => void loadAlerts()}
						className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 transition-colors"
					>
						Apply Filters
					</button>
				</div>

				{errorMessage ? <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 font-medium">{errorMessage}</p> : null}

				<div className="space-y-3">
					{alerts.length === 0 ? (
						<div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-12 text-center text-sm text-slate-500">
							<RefreshCw size={24} className="mx-auto mb-2 opacity-20" />
							No alerts match current filters.
						</div>
					) : (
						alerts.map((item) => (
							<article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:shadow-md transition-shadow">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<div className="flex items-center gap-2">
										<span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-500 border border-slate-200">{item.threatType}</span>
										<span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${item.severity === 'high' ? 'bg-rose-50 text-rose-600 border border-rose-100' : 'bg-amber-50 text-amber-600 border border-amber-100'}`}>
											{item.severity}
										</span>
										<span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase border ${statusClass(item.status)}`}>
											{item.status}
										</span>
									</div>
									<p className="text-[10px] font-medium text-slate-400">{new Date(item.createdAt).toLocaleString()}</p>
								</div>
								<div className="mt-2">
									<p className="text-sm font-semibold text-slate-800">{item.message ?? `Threat detected: ${item.threatType}`}</p>
									<p className="mt-1 text-xs text-slate-500 leading-relaxed">
										Significant changes identified. Area: <span className="font-bold text-slate-700">{item.areaKm2.toFixed(3)} km²</span> • <span className="font-bold text-slate-700">{item.percentOfAoi.toFixed(2)}%</span> of total AOI.
									</p>
								</div>
								<div className="mt-4 flex flex-wrap gap-2">
									<button
										type="button"
										onClick={() => void acknowledgeAlert(item.id)}
										disabled={item.status !== "active"}
										className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-100 disabled:opacity-50 transition-colors"
									>
										<CheckCheck size={14} />
										Acknowledge
									</button>
									<button
										type="button"
										onClick={() => void resolveAlert(item.id)}
										disabled={item.status === "resolved"}
										className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 transition-colors"
									>
										Resolve
									</button>
									<button
										type="button"
										onClick={() => void markRead(item.id)}
										disabled={!!item.readAt}
										className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
									>
										Mark Read
									</button>
								</div>
							</article>
						))
					)}
				</div>
			</main>
		</div>
	);
}
