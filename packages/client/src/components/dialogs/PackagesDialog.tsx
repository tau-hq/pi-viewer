import { Package } from "lucide-react";
import { useState } from "react";
import { t } from "@/i18n";
import { useUiStore } from "@/store/ui-store";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { PackagesTab } from "./PackagesTab";
import { ResourcesTab } from "./ResourcesTab";
import { useProjectCwd } from "./use-project-cwd";

type PackagesView = "packages" | "resources";

/**
 * pi's package management and its resource switches in one dialog: both work on the same
 * settings files and the same working directory.
 */
export function PackagesDialog() {
	const open = useUiStore((s) => s.dialog === "packages");
	const closeDialog = useUiStore((s) => s.closeDialog);
	const projectCwd = useProjectCwd();
	const [view, setView] = useState<PackagesView>("packages");
	const [scope, setScope] = useState<"user" | "project">("user");

	return (
		<Dialog open={open} onOpenChange={(next) => !next && closeDialog()}>
			<DialogContent data-testid="packages-dialog" size="lg">
				<DialogHeader>
					<div className="flex items-center gap-2">
						<Package className="size-4 text-muted-foreground" />
						<DialogTitle>{t("packages.title")}</DialogTitle>
					</div>
					<DialogDescription>{t("packages.description")}</DialogDescription>
				</DialogHeader>
				<Tabs value={view} onValueChange={(value) => setView(value === "resources" ? "resources" : "packages")}>
					<TabsList>
						<TabsTrigger value="packages" data-testid="packages-view-packages">
							{t("packages.tabPackages")}
						</TabsTrigger>
						<TabsTrigger value="resources" data-testid="packages-view-resources">
							{t("packages.tabResources")}
						</TabsTrigger>
					</TabsList>
				</Tabs>
				{view === "packages" ? (
					<PackagesTab cwd={projectCwd} scope={scope} onScopeChange={setScope} />
				) : (
					<ResourcesTab cwd={projectCwd} scope={scope} onScopeChange={setScope} />
				)}
			</DialogContent>
		</Dialog>
	);
}
