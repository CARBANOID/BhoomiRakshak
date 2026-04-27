"use client";

import { backendUrl } from "@/config/backendUrl";
import { CalendarClock, Loader2, Play, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type AoiItem = {
	id: string;
	name: string;
};

type MonitoringSchedule = {
	id: string;
	aoiId: string;
	cadence: "daily" | "weekly";
	isActive: boolean;
	nextRunAt: string;
	createdAt: string;
	aoi?: {
		id: string;
		name: string;
		sourceType: string | null;
		isDeleted: boolean;
	};
};

type MonitoringRun = {
	id: string;
	aoiId: string;
	status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
	runDate: string;
	createdAt: string;
	queuedAt: string;
	startedAt: string | null;
	completedAt: string | null;
	errorMessage: string | null;
	aoi?: {
		id: string;
		name: string;
		sourceType: string | null;
	};
	thresholdProfile?: {
		id: string;
		name: string;
		mode: string;
		isDefault: boolean;
	} | null;
};

type ThresholdProfile = {
	id: string;
	name: string;
	mode: "strict" | "balanced" | "permissive" | "custom";
	isDefault: boolean;
};

type AoiResponse = {
	aoi: AoiItem[];
};

type SchedulesResponse = {
	schedules: MonitoringSchedule[];
};

type RunsResponse = {
	runs: MonitoringRun[];
	pagination?: {
		page: number;
		limit: number;
		total: number;
		totalPages: number;
		sort: "asc" | "desc";
	};
};

type ThresholdProfilesResponse = {
	profiles: ThresholdProfile[];
};

type MonitoringPanelProps = {
	aoiRefreshKey?: number;
	preferredAoiId?: string | null;
};

function toDateTimeLocalValue(date: Date): string {
	const offsetMs = date.getTimezoneOffset() * 60_000;
	return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function formatDateTime(value: string | null): string {
	if (!value) {
		return "-";
	}
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		return value;
	}
	return parsed.toLocaleString();
}

function shortId(value: string): string {
	if (value.length <= 14) {
		return value;
	}
	return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function statusClass(status: MonitoringRun["status"]): string {
	switch (status) {
		case "succeeded":
			return "bg-emerald-100 text-emerald-700";
		case "failed":
			return "bg-rose-100 text-rose-700";
		case "running":
			return "bg-blue-100 text-blue-700";
		case "cancelled":
			return "bg-slate-200 text-slate-700";
		default:
			return "bg-amber-100 text-amber-700";
	}
}

function getStoredToken(): string | null {
	if (typeof window === "undefined") {
		return null;
	}
	const token = window.localStorage.getItem("token");
	if (!token || token.length === 0) {
		return null;
	}
	return token;
}

export function MonitoringPanel({ aoiRefreshKey = 0, preferredAoiId = null }: MonitoringPanelProps) {
	const [token, setToken] = useState<string | null>(null);
	const [aois, setAois] = useState<AoiItem[]>([]);
	const [selectedAoiId, setSelectedAoiId] = useState<string>("");
	const [schedules, setSchedules] = useState<MonitoringSchedule[]>([]);
	const [runs, setRuns] = useState<MonitoringRun[]>([]);
	const [profiles, setProfiles] = useState<ThresholdProfile[]>([]);
	const [selectedThresholdProfileId, setSelectedThresholdProfileId] = useState<string>("");
	const [runStatusFilter, setRunStatusFilter] = useState<string>("");
	const [runFromFilter, setRunFromFilter] = useState<string>("");
	const [runToFilter, setRunToFilter] = useState<string>("");
	const [runPage, setRunPage] = useState(1);
	const [runTotalPages, setRunTotalPages] = useState(1);
	const [cadence, setCadence] = useState<"daily" | "weekly">("daily");
	const [nextRunAtInput, setNextRunAtInput] = useState<string>(() => {
		const next = new Date(Date.now() + 10 * 60 * 1000);
		return toDateTimeLocalValue(next);
	});
	const [isLoading, setIsLoading] = useState(false);
	const [isMutating, setIsMutating] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string>("");
	const [successMessage, setSuccessMessage] = useState<string>("");

	useEffect(() => {
		setToken(getStoredToken());
	}, []);

	const authedFetch = useCallback(
		async <T,>(path: string, init?: RequestInit): Promise<T> => {
			if (!token) {
				throw new Error("Sign in first to use monitoring controls.");
			}

			const response = await fetch(`${backendUrl}/bhoomi${path}`, {
				...init,
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${token}`
				}
			});

			const bodyText = await response.text();
			let body: unknown = {};
			if (bodyText.length > 0) {
				try {
					body = JSON.parse(bodyText);
				} catch {
					body = { message: bodyText };
				}
			}

			if (!response.ok) {
				const serverMessage =
					typeof body === "object" && body !== null && "message" in body && typeof body.message === "string"
						? body.message
						: `Request failed with status ${response.status}`;
				throw new Error(serverMessage);
			}

			return body as T;
		},
		[token]
	);

	const selectedAoiName = useMemo(() => {
		const selected = aois.find((item) => item.id === selectedAoiId);
		return selected?.name ?? "-";
	}, [aois, selectedAoiId]);

	const selectedThresholdProfile = useMemo(() => {
		if (!selectedThresholdProfileId) {
			return null;
		}
		return profiles.find((profile) => profile.id === selectedThresholdProfileId) ?? null;
	}, [profiles, selectedThresholdProfileId]);

	const loadAois = useCallback(async (preferredId?: string | null) => {
		setErrorMessage("");
		const payload = await authedFetch<AoiResponse>("/aoi");
		setAois(payload.aoi);
		setSelectedAoiId((current) => {
			if (preferredId && payload.aoi.some((item) => item.id === preferredId)) {
				return preferredId;
			}
			if (current && payload.aoi.some((item) => item.id === current)) {
				return current;
			}
			return payload.aoi[0]?.id ?? "";
		});
	}, [authedFetch]);

	const loadThresholdProfiles = useCallback(async () => {
		const payload = await authedFetch<ThresholdProfilesResponse>("/threshold-profiles");
		setProfiles(payload.profiles);
		setSelectedThresholdProfileId((current) => {
			if (current && payload.profiles.some((profile) => profile.id === current)) {
				return current;
			}
			const nextDefault = payload.profiles.find((profile) => profile.isDefault);
			return nextDefault?.id ?? "";
		});
	}, [authedFetch]);

	const loadMonitoring = useCallback(
		async (aoiId: string, targetRunPage = runPage) => {
			if (!aoiId) {
				setSchedules([]);
				setRuns([]);
				setRunTotalPages(1);
				return;
			}

			setErrorMessage("");
			setIsLoading(true);
			try {
				const runQuery = new URLSearchParams();
				runQuery.set("aoiId", aoiId);
				runQuery.set("page", String(targetRunPage));
				runQuery.set("limit", "10");
				if (runStatusFilter) {
					runQuery.set("status", runStatusFilter);
				}
				if (runFromFilter) {
					runQuery.set("from", new Date(runFromFilter).toISOString());
				}
				if (runToFilter) {
					runQuery.set("to", new Date(runToFilter).toISOString());
				}
				if (selectedThresholdProfileId) {
					runQuery.set("thresholdProfileId", selectedThresholdProfileId);
				}

				const [schedulePayload, runPayload] = await Promise.all([
					authedFetch<SchedulesResponse>(`/monitoring/schedules?aoiId=${encodeURIComponent(aoiId)}&limit=20`),
					authedFetch<RunsResponse>(`/monitoring/runs?${runQuery.toString()}`)
				]);
				setSchedules(schedulePayload.schedules);
				setRuns(runPayload.runs);
				setRunTotalPages(runPayload.pagination?.totalPages ?? 1);
				setRunPage(runPayload.pagination?.page ?? targetRunPage);
			} catch (error) {
				setErrorMessage(error instanceof Error ? error.message : "Unable to load monitoring data.");
			} finally {
				setIsLoading(false);
			}
		},
		[authedFetch, runFromFilter, runPage, runStatusFilter, runToFilter, selectedThresholdProfileId]
	);

	useEffect(() => {
		if (!token) {
			setErrorMessage("Sign in to manage schedules and runs.");
			return;
		}

		void (async () => {
			try {
				setIsLoading(true);
				await Promise.all([loadAois(preferredAoiId), loadThresholdProfiles()]);
			} catch (error) {
				setErrorMessage(error instanceof Error ? error.message : "Unable to load AOIs.");
			} finally {
				setIsLoading(false);
			}
		})();
	}, [token, loadAois, loadThresholdProfiles, aoiRefreshKey, preferredAoiId]);

	useEffect(() => {
		if (!token || !selectedAoiId) {
			return;
		}
		void loadMonitoring(selectedAoiId, runPage);
	}, [token, selectedAoiId, loadMonitoring, runPage]);

	const queueRun = useCallback(async () => {
		if (!selectedAoiId) {
			setErrorMessage("Select an AOI before queueing a run.");
			return;
		}

		setErrorMessage("");
		setSuccessMessage("");
		setIsMutating(true);
		try {
			await authedFetch<{ runId: string }>("/monitoring/runs", {
				method: "POST",
				body: JSON.stringify({
					aoiId: selectedAoiId,
					thresholdProfileId: selectedThresholdProfile?.id
				})
			});
			setSuccessMessage("Monitoring run queued.");
			await loadMonitoring(selectedAoiId, 1);
		} catch (error) {
			setErrorMessage(error instanceof Error ? error.message : "Unable to queue run.");
		} finally {
			setIsMutating(false);
		}
	}, [authedFetch, loadMonitoring, selectedAoiId, selectedThresholdProfile]);

	const createSchedule = useCallback(async () => {
		if (!selectedAoiId) {
			setErrorMessage("Select an AOI before creating a schedule.");
			return;
		}

		const nextRun = new Date(nextRunAtInput);
		if (Number.isNaN(nextRun.getTime())) {
			setErrorMessage("Provide a valid next run date and time.");
			return;
		}

		setErrorMessage("");
		setSuccessMessage("");
		setIsMutating(true);
		try {
			await authedFetch<{ message: string }>("/monitoring/schedules", {
				method: "POST",
				body: JSON.stringify({
					aoiId: selectedAoiId,
					cadence,
					nextRunAt: nextRun.toISOString()
				})
			});
			setSuccessMessage("Schedule created.");
			await loadMonitoring(selectedAoiId);
		} catch (error) {
			setErrorMessage(error instanceof Error ? error.message : "Unable to create schedule.");
		} finally {
			setIsMutating(false);
		}
	}, [authedFetch, cadence, loadMonitoring, nextRunAtInput, selectedAoiId]);

	const applyRunFilters = useCallback(() => {
		if (!selectedAoiId) {
			return;
		}
		setRunPage(1);
		void loadMonitoring(selectedAoiId, 1);
	}, [loadMonitoring, selectedAoiId]);

	const toggleSchedule = useCallback(
		async (schedule: MonitoringSchedule) => {
			setErrorMessage("");
			setSuccessMessage("");
			setIsMutating(true);
			try {
				await authedFetch<{ message: string }>(`/monitoring/schedules/${schedule.id}`, {
					method: "PATCH",
					body: JSON.stringify({ isActive: !schedule.isActive })
				});
				setSuccessMessage(schedule.isActive ? "Schedule paused." : "Schedule resumed.");
				await loadMonitoring(selectedAoiId, runPage);
			} catch (error) {
				setErrorMessage(error instanceof Error ? error.message : "Unable to update schedule.");
			} finally {
				setIsMutating(false);
			}
		},
		[authedFetch, loadMonitoring, runPage, selectedAoiId]
	);

	const deleteSchedule = useCallback(
		async (scheduleId: string) => {
			setErrorMessage("");
			setSuccessMessage("");
			setIsMutating(true);
			try {
				await authedFetch<{ message: string }>(`/monitoring/schedules/${scheduleId}`, {
					method: "DELETE"
				});
				setSuccessMessage("Schedule deleted.");
				await loadMonitoring(selectedAoiId, runPage);
			} catch (error) {
				setErrorMessage(error instanceof Error ? error.message : "Unable to delete schedule.");
			} finally {
				setIsMutating(false);
			}
		},
		[authedFetch, loadMonitoring, runPage, selectedAoiId]
	);

	const disableActions = isLoading || isMutating || !token;

	return (
		<div id="monitoring" className="w-full max-w-4xl mx-auto rounded-2xl border border-slate-200 bg-white shadow-xl">
			<div className="border-b border-slate-200 bg-linear-to-r from-emerald-50 to-cyan-50 px-4 py-3">
				<div className="flex items-center justify-between">
					<div>
						<p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Monitoring</p>
						<h2 className="text-lg font-bold text-slate-900">Schedule and Run Control</h2>
					</div>
					<button
						type="button"
						onClick={() => {
							if (selectedAoiId) {
								void loadMonitoring(selectedAoiId);
							}
						}}
						disabled={disableActions || !selectedAoiId}
						className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
					>
						<RefreshCw size={14} />
						Refresh
					</button>
				</div>
			</div>

			<div className="space-y-4 p-4">
				<div className="space-y-1.5">
					<label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Area of Interest</label>
					<select
						value={selectedAoiId}
						onChange={(event) => setSelectedAoiId(event.target.value)}
						disabled={disableActions || aois.length === 0}
						className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-emerald-400 focus:outline-none"
					>
						{aois.length === 0 ? <option value="">No AOI found</option> : null}
						{aois.map((aoi) => (
							<option key={aoi.id} value={aoi.id}>
								{aoi.name}
							</option>
						))}
					</select>
					<p className="text-xs text-slate-500">Selected: {selectedAoiName}</p>
				</div>

				<div className="grid grid-cols-2 gap-2">
					<button
						type="button"
						onClick={() => void queueRun()}
						disabled={disableActions || !selectedAoiId}
						className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
					>
						<Play size={14} />
						Queue Run
					</button>
					<button
						type="button"
						onClick={() => {
							if (selectedAoiId) {
								void loadMonitoring(selectedAoiId);
							}
						}}
						disabled={disableActions || !selectedAoiId}
						className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
					>
						{isLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
						Reload
					</button>
				</div>

				<div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
					<p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Run Profile</p>
					<select
						value={selectedThresholdProfileId}
						onChange={(event) => setSelectedThresholdProfileId(event.target.value)}
						disabled={disableActions}
						className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-800 focus:border-emerald-400 focus:outline-none"
					>
						<option value="">No Profile (use model defaults)</option>
						{profiles.map((profile) => (
							<option key={profile.id} value={profile.id}>
								{profile.name} ({profile.mode}){profile.isDefault ? " • default" : ""}
							</option>
						))}
					</select>
					<p className="mt-1 text-[11px] text-slate-500">
						Queued runs inherit this profile. Current: {selectedThresholdProfile?.name ?? "none"}
					</p>
				</div>

				<div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
					<p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Create Schedule</p>
					<div className="grid grid-cols-2 gap-2">
						<select
							value={cadence}
							onChange={(event) => setCadence(event.target.value as "daily" | "weekly")}
							disabled={disableActions}
							className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-800 focus:border-emerald-400 focus:outline-none"
						>
							<option value="daily">Daily</option>
							<option value="weekly">Weekly</option>
						</select>
						<input
							type="datetime-local"
							value={nextRunAtInput}
							onChange={(event) => setNextRunAtInput(event.target.value)}
							disabled={disableActions}
							className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-800 focus:border-emerald-400 focus:outline-none"
						/>
					</div>
					<button
						type="button"
						onClick={() => void createSchedule()}
						disabled={disableActions || !selectedAoiId}
						className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
					>
						<CalendarClock size={14} />
						Create
					</button>
				</div>

				{errorMessage ? (
					<div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">{errorMessage}</div>
				) : null}
				{successMessage ? (
					<div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
						{successMessage}
					</div>
				) : null}

				<div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
					<p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Run Filters</p>
					<div className="grid grid-cols-2 gap-2">
						<select
							value={runStatusFilter}
							onChange={(event) => setRunStatusFilter(event.target.value)}
							className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-800 focus:border-emerald-400 focus:outline-none"
						>
							<option value="">All statuses</option>
							<option value="queued">queued</option>
							<option value="running">running</option>
							<option value="succeeded">succeeded</option>
							<option value="failed">failed</option>
							<option value="cancelled">cancelled</option>
						</select>
						<input
							type="datetime-local"
							value={runFromFilter}
							onChange={(event) => setRunFromFilter(event.target.value)}
							className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-800 focus:border-emerald-400 focus:outline-none"
						/>
						<input
							type="datetime-local"
							value={runToFilter}
							onChange={(event) => setRunToFilter(event.target.value)}
							className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-800 focus:border-emerald-400 focus:outline-none"
						/>
						<button
							type="button"
							onClick={applyRunFilters}
							disabled={disableActions || !selectedAoiId}
							className="rounded-lg bg-slate-900 px-2.5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
						>
							Apply
						</button>
					</div>
				</div>

				<div className="space-y-2">
					<p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Schedules</p>
					<div className="max-h-48 space-y-2 overflow-auto pr-1">
						{schedules.length === 0 ? (
							<div className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500">
								No schedules for this AOI.
							</div>
						) : (
							schedules.map((schedule) => (
								<div key={schedule.id} className="rounded-lg border border-slate-200 bg-white p-2.5 text-xs text-slate-700">
									<div className="flex items-center justify-between gap-2">
										<span className="font-semibold text-slate-900">{schedule.cadence}</span>
										<span
											className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
												schedule.isActive ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-700"
											}`}
										>
											{schedule.isActive ? "active" : "paused"}
										</span>
									</div>
									<p className="mt-1 text-[11px] text-slate-500">Next: {formatDateTime(schedule.nextRunAt)}</p>
									<div className="mt-2 flex gap-1.5">
										<button
											type="button"
											onClick={() => void toggleSchedule(schedule)}
											disabled={disableActions}
											className="rounded-md border border-slate-300 px-2 py-1 text-[11px] font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
										>
											{schedule.isActive ? "Pause" : "Resume"}
										</button>
										<button
											type="button"
											onClick={() => void deleteSchedule(schedule.id)}
											disabled={disableActions}
											className="inline-flex items-center gap-1 rounded-md border border-rose-300 px-2 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
										>
											<Trash2 size={11} />
											Delete
										</button>
									</div>
								</div>
							))
						)}
					</div>
				</div>

				<div className="space-y-2">
					<p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recent Runs</p>
					<div className="max-h-52 space-y-2 overflow-auto pr-1">
						{runs.length === 0 ? (
							<div className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-500">
								No runs yet for this AOI.
							</div>
						) : (
							runs.map((run) => (
								<div key={run.id} className="rounded-lg border border-slate-200 bg-white p-2.5 text-xs text-slate-700">
									<div className="flex items-center justify-between gap-2">
										<span className="font-mono text-[11px] text-slate-500">{shortId(run.id)}</span>
										<span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusClass(run.status)}`}>
											{run.status}
										</span>
									</div>
									<p className="mt-1 text-[11px] text-slate-500">Run date: {formatDateTime(run.runDate)}</p>
									{run.thresholdProfile ? (
										<p className="mt-1 text-[11px] text-slate-500">Profile: {run.thresholdProfile.name}</p>
									) : null}
									{run.errorMessage ? (
										<p className="mt-1 rounded bg-rose-50 px-2 py-1 text-[11px] text-rose-700">{run.errorMessage}</p>
									) : null}
								</div>
							))
						)}
					</div>
					{runTotalPages > 1 ? (
						<div className="flex items-center justify-between pt-1">
							<button
								type="button"
								onClick={() => setRunPage((prev) => Math.max(1, prev - 1))}
								disabled={disableActions || runPage <= 1}
								className="rounded-md border border-slate-300 px-2 py-1 text-[11px] font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
							>
								Prev
							</button>
							<p className="text-[11px] text-slate-500">
								Page {runPage} of {runTotalPages}
							</p>
							<button
								type="button"
								onClick={() => setRunPage((prev) => Math.min(runTotalPages, prev + 1))}
								disabled={disableActions || runPage >= runTotalPages}
								className="rounded-md border border-slate-300 px-2 py-1 text-[11px] font-medium hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
							>
								Next
							</button>
						</div>
					) : null}
				</div>
			</div>
		</div>
	);
}
