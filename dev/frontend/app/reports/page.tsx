"use client";

import { DashboardSidebar } from "@/component/DashboardSidebar";
import { backendUrl } from "@/config/backendUrl";
import { Download, FileJson, FileText, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type ReportListItem = {
	id: string;
	runId: string;
	summary: Record<string, unknown>;
	details: Record<string, unknown> | null;
	generatedAt: string;
	run: {
		id: string;
		status: string;
		runDate: string;
		aoi: {
			id: string;
			name: string;
		};
	};
};

type ReportDetail = {
	id: string;
	runId: string;
	summary: Record<string, unknown>;
	details: Record<string, unknown> | null;
	generatedAt: string;
};

function getToken(): string | null {
	if (typeof window === "undefined") {
		return null;
	}
	return window.localStorage.getItem("token");
}

function downloadBlob(blob: Blob, fileName: string) {
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = fileName;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(url);
}

export default function ReportsPage() {
	const [token, setToken] = useState<string | null>(null);
	const [reports, setReports] = useState<ReportListItem[]>([]);
	const [selectedRunId, setSelectedRunId] = useState<string>("");
	const [reportDetail, setReportDetail] = useState<ReportDetail | null>(null);
	const [isLoadingList, setIsLoadingList] = useState(false);
	const [isLoadingDetail, setIsLoadingDetail] = useState(false);
	const [errorMessage, setErrorMessage] = useState("");

	useEffect(() => {
		setToken(getToken());
	}, []);

	const authedFetchJson = useCallback(
		async <T,>(path: string): Promise<T> => {
			if (!token) {
				throw new Error("Sign in first to view reports.");
			}
			const response = await fetch(`${backendUrl}/bhoomi${path}`, {
				headers: {
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

	const loadReports = useCallback(async () => {
		if (!token) {
			return;
		}
		setErrorMessage("");
		setIsLoadingList(true);
		try {
			const payload = await authedFetchJson<{ reports: ReportListItem[] }>("/reports?limit=100");
			setReports(payload.reports);
			setSelectedRunId((current) => current || payload.reports[0]?.runId || "");
		} catch (error) {
			setErrorMessage(error instanceof Error ? error.message : "Unable to load reports.");
		} finally {
			setIsLoadingList(false);
		}
	}, [authedFetchJson, token]);

	const loadReportDetail = useCallback(async () => {
		if (!selectedRunId) {
			setReportDetail(null);
			return;
		}
		setErrorMessage("");
		setIsLoadingDetail(true);
		try {
			const payload = await authedFetchJson<{ report: ReportDetail }>(`/reports/${selectedRunId}`);
			setReportDetail(payload.report);
		} catch (error) {
			setErrorMessage(error instanceof Error ? error.message : "Unable to load report detail.");
		} finally {
			setIsLoadingDetail(false);
		}
	}, [authedFetchJson, selectedRunId]);

	useEffect(() => {
		void loadReports();
	}, [loadReports]);

	useEffect(() => {
		void loadReportDetail();
	}, [loadReportDetail]);

	const selectedReportMeta = useMemo(() => reports.find((item) => item.runId === selectedRunId) ?? null, [reports, selectedRunId]);

	const exportReport = useCallback(
		async (format: "json" | "pdf") => {
			if (!selectedRunId || !token) {
				return;
			}
			const response = await fetch(`${backendUrl}/bhoomi/reports/${selectedRunId}/export?format=${format}`, {
				headers: {
					Authorization: `Bearer ${token}`
				}
			});

			if (!response.ok) {
				const body = await response.json();
				throw new Error(body.message ?? `Export failed (${response.status})`);
			}

			if (format === "json") {
				const payload = await response.json();
				downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), `report-${selectedRunId}.json`);
				return;
			}

			const blob = await response.blob();
			downloadBlob(blob, `report-${selectedRunId}.pdf`);
		},
		[selectedRunId, token]
	);

	return (
		<div className="flex min-h-screen bg-gradient-to-br from-emerald-50 via-cyan-50 to-sky-100 p-4 gap-4">
			<div className="hidden md:block shrink-0">
				<DashboardSidebar />
			</div>
			<main className="flex-1 grid max-w-6xl gap-4 rounded-3xl border border-emerald-100 bg-white/90 p-6 shadow-xl backdrop-blur-sm md:grid-cols-[20rem,1fr]">
				<section className="rounded-2xl border border-slate-200 bg-white p-3">
					<div className="mb-3 flex items-center justify-between">
						<div>
							<p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Monitoring</p>
							<h1 className="text-xl font-bold text-slate-900">Reports</h1>
						</div>
						<button
							type="button"
							onClick={() => void loadReports()}
							className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
						>
							<RefreshCw size={13} className={isLoadingList ? "animate-spin" : ""} />
							Reload
						</button>
					</div>

					<div className="max-h-[65vh] space-y-2 overflow-auto pr-1">
						{reports.length === 0 ? (
							<div className="rounded-lg border border-dashed border-slate-300 px-3 py-8 text-center text-sm text-slate-500">
								No generated reports found.
							</div>
						) : (
							reports.map((item) => (
								<button
									type="button"
									key={item.id}
									onClick={() => setSelectedRunId(item.runId)}
									className={`w-full rounded-xl border px-3 py-2 text-left ${selectedRunId === item.runId ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
								>
									<p className="text-sm font-semibold text-slate-900">{item.run.aoi.name}</p>
									<p className="text-xs text-slate-500">Run {item.runId.slice(0, 8)} • {new Date(item.generatedAt).toLocaleString()}</p>
								</button>
							))
						)}
					</div>
				</section>

				<section className="rounded-2xl border border-slate-200 bg-white p-4">
					<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
						<div>
							<h2 className="text-lg font-bold text-slate-900">Report Viewer</h2>
							<p className="text-xs text-slate-500">
								{selectedReportMeta
									? `${selectedReportMeta.run.aoi.name} • ${new Date(selectedReportMeta.generatedAt).toLocaleString()}`
									: "Select a report from the list"}
							</p>
						</div>

						<div className="flex gap-2">
							<button
								type="button"
								onClick={() => void exportReport("json")}
								disabled={!selectedRunId}
								className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
							>
								<FileJson size={13} />
								JSON
							</button>
							<button
								type="button"
								onClick={() => void exportReport("pdf")}
								disabled={!selectedRunId}
								className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
							>
								<Download size={13} />
								PDF
							</button>
						</div>
					</div>

					{errorMessage ? <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{errorMessage}</p> : null}

					{isLoadingDetail ? (
						<div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-8 text-center text-sm text-slate-500">Loading report...</div>
					) : reportDetail ? (
						<div className="grid gap-3 md:grid-cols-2">
							<div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
								<p className="mb-2 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
									<FileText size={13} />
									Summary
								</p>
								<pre className="max-h-[55vh] overflow-auto rounded-lg bg-white p-3 text-xs text-slate-700">{JSON.stringify(reportDetail.summary, null, 2)}</pre>
							</div>

							<div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
								<p className="mb-2 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
									<FileText size={13} />
									Details
								</p>
								<pre className="max-h-[55vh] overflow-auto rounded-lg bg-white p-3 text-xs text-slate-700">{JSON.stringify(reportDetail.details ?? {}, null, 2)}</pre>
							</div>
						</div>
					) : (
						<div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-8 text-center text-sm text-slate-500">
							Select a report to inspect summary and details.
						</div>
					)}
				</section>
			</main>
		</div>
	);
}
