import { ChevronRight, CornerLeftUp, Folder } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@/i18n";
import { joinPath, parentPath, pathCrumbs } from "@/lib/paths";
import { pickArray, pickString } from "@/lib/result-data";
import { cn } from "@/lib/utils";
import { getTransport } from "@/transport/transport";
import { Spinner } from "../ui/spinner";

interface Listing {
	path: string;
	dirs: string[];
}

interface DirectoryPickerProps {
	/** The text field's value; navigation writes the resolved path back through onChange. */
	value: string;
	onChange: (path: string) => void;
	separator: string;
}

const TYPING_DELAY_MS = 350;

/** Breadcrumb + subdirectory list driven by the host's `fs.listDirs`; follows what is typed. */
export function DirectoryPicker({ value, onChange, separator }: DirectoryPickerProps) {
	const [listing, setListing] = useState<Listing | undefined>(undefined);
	const [status, setStatus] = useState<"idle" | "loading" | "missing">("idle");
	const requestSeq = useRef(0);
	const onChangeRef = useRef(onChange);
	onChangeRef.current = onChange;

	const list = useCallback(async (path: string | undefined, follow: boolean) => {
		const seq = ++requestSeq.current;
		setStatus("loading");
		try {
			const data = await getTransport().send(path ? { type: "fs.listDirs", path } : { type: "fs.listDirs" });
			if (seq !== requestSeq.current) return;
			const dir = pickString(data, "path");
			if (!dir) throw new Error("fs.listDirs: no path");
			const dirs = pickArray<unknown>(data, "dirs").filter((name): name is string => typeof name === "string");
			setListing({ path: dir, dirs });
			setStatus("idle");
			if (follow) onChangeRef.current(dir);
		} catch {
			if (seq === requestSeq.current) setStatus("missing");
		}
	}, []);

	// The first listing is immediate (host default when empty); typed paths are listed after a pause.
	useEffect(() => {
		const path = value.trim();
		if (listing && path === listing.path) return;
		if (!path) {
			if (!listing) void list(undefined, true);
			return;
		}
		const timer = setTimeout(() => void list(path, false), listing ? TYPING_DELAY_MS : 0);
		return () => clearTimeout(timer);
	}, [value, listing, list]);

	const navigate = (path: string) => void list(path, true);
	const parent = listing ? parentPath(listing.path, separator) : undefined;
	const crumbs = listing ? pathCrumbs(listing.path, separator) : [];

	return (
		<div className="flex flex-col gap-1.5" data-testid="directory-picker">
			<div className="flex min-h-6 flex-wrap items-center gap-0.5 text-xs">
				{crumbs.map((crumb, index) => (
					<span key={crumb.path} className="flex items-center gap-0.5">
						{index > 0 && <ChevronRight className="size-3 text-muted-foreground" />}
						<button
							type="button"
							onClick={() => navigate(crumb.path)}
							className={cn(
								"max-w-40 truncate rounded px-1 py-0.5 font-mono hover:bg-accent",
								index === crumbs.length - 1 ? "text-foreground" : "text-muted-foreground",
							)}
						>
							{crumb.label}
						</button>
					</span>
				))}
				{status === "loading" && <Spinner className="ml-1 size-3 text-muted-foreground" />}
				{status === "missing" && <span className="ml-1 text-destructive">{t("newSession.notFound")}</span>}
			</div>
			<ul
				className="max-h-44 overflow-y-auto rounded-md border border-border p-1 text-sm"
				aria-label={t("newSession.browse")}
			>
				{parent !== undefined && (
					<li>
						<button
							type="button"
							onClick={() => navigate(parent)}
							className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-muted-foreground hover:bg-accent hover:text-accent-foreground"
							title={t("newSession.parent")}
						>
							<CornerLeftUp className="size-3.5 shrink-0" />
							<span className="font-mono">..</span>
						</button>
					</li>
				)}
				{listing?.dirs.map((name) => (
					<li key={name}>
						<button
							type="button"
							onClick={() => navigate(joinPath(listing.path, name, separator))}
							className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-accent hover:text-accent-foreground"
						>
							<Folder className="size-3.5 shrink-0 text-muted-foreground" />
							<span className="min-w-0 flex-1 truncate font-mono">{name}</span>
						</button>
					</li>
				))}
				{listing && listing.dirs.length === 0 && (
					<li className="px-2 py-2 text-center text-muted-foreground text-xs">{t("newSession.noSubdirs")}</li>
				)}
			</ul>
		</div>
	);
}
