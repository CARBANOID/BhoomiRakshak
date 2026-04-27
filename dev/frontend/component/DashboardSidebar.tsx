"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, FileText, LogOut, Map, Shield, SlidersHorizontal } from "lucide-react";

const items = [
	{ href: "/map", label: "Map", icon: Map },
	{ href: "/alerts", label: "Alerts", icon: AlertTriangle },
	{ href: "/reports", label: "Reports", icon: FileText },
	{ href: "/monitoring", label: "Monitoring", icon: SlidersHorizontal }
];

export function DashboardSidebar() {
	const pathname = usePathname();
	const router = useRouter();

	const handleSignOut = () => {
		if (typeof window !== "undefined") {
			window.localStorage.removeItem("token");
			window.localStorage.removeItem("shortname");
		}
		router.push("/auth/signin");
	};

	return (
		<aside className="w-56 rounded-2xl border border-emerald-200/70 bg-white/90 p-3 shadow-xl backdrop-blur-sm h-fit">
			<div className="mb-3 flex items-center gap-2 px-2">
				<div className="rounded-xl bg-emerald-100 p-2 text-emerald-700">
					<Shield size={16} />
				</div>
				<div>
					<p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">BhoomiRakshak</p>
					<p className="text-[11px] text-slate-500">Ops Dashboard</p>
				</div>
			</div>

			<nav className="space-y-1">
				{items.map((item) => {
					const Icon = item.icon;
					const isActive = item.href === pathname;
					return (
						<Link
							key={item.href}
							href={item.href}
							className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
								isActive
									? "bg-emerald-600 text-white"
									: "text-slate-700 hover:bg-emerald-50 hover:text-emerald-700"
							}`}
						>
							<Icon size={15} />
							{item.label}
						</Link>
					);
				})}
			</nav>

			<button
				type="button"
				onClick={handleSignOut}
				className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-rose-200 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50"
			>
				<LogOut size={14} />
				Sign Out
			</button>
		</aside>
	);
}
