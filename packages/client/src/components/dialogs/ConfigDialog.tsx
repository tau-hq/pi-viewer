import type { ConfigScope } from "@pi-tau/shared";
import { ListChecks, Settings } from "lucide-react";
import { useState } from "react";
import { t } from "@/i18n";
import { useUiStore } from "@/store/ui-store";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { ConfigEditor } from "./ConfigEditor";
import { SettingsForm } from "./SettingsForm";
import { TrustSection } from "./TrustSection";
import { useProjectCwd } from "./use-project-cwd";

/**
 * pi's configuration: typed controls for the settings a GUI can explain, and the raw JSON
 * editor for everything else. Both write to the scope picked here.
 */
export function ConfigDialog() {
	const open = useUiStore((s) => s.dialog === "config");
	const closeDialog = useUiStore((s) => s.closeDialog);
	const projectCwd = useProjectCwd();
	const [view, setView] = useState<"form" | "raw">("form");
	const [scope, setScope] = useState<ConfigScope>("global");

	return (
		<Dialog open={open} onOpenChange={(next) => !next && closeDialog()}>
			<DialogContent data-testid="config-dialog" size="lg">
				<DialogHeader>
					<div className="flex items-center gap-2">
						<Settings className="size-4 text-muted-foreground" />
						<DialogTitle>{t("config.title")}</DialogTitle>
					</div>
					<DialogDescription>{t("config.description")}</DialogDescription>
				</DialogHeader>
				<div className="flex flex-wrap items-center gap-2">
					<Tabs value={view} onValueChange={(value) => setView(value === "raw" ? "raw" : "form")}>
						<TabsList>
							<TabsTrigger value="form" data-testid="config-view-form">
								{t("settingsForm.tab")}
							</TabsTrigger>
							<TabsTrigger value="raw" data-testid="config-view-raw">
								{t("settingsForm.tabRaw")}
							</TabsTrigger>
						</TabsList>
					</Tabs>
					<div className="flex-1" />
					<Tabs value={scope} onValueChange={(value) => setScope(value as ConfigScope)}>
						<TabsList>
							<TabsTrigger value="global" data-testid="config-scope-global">
								{t("config.global")}
							</TabsTrigger>
							<TabsTrigger value="project" data-testid="config-scope-project" disabled={!projectCwd}>
								{t("config.project")}
							</TabsTrigger>
						</TabsList>
					</Tabs>
				</div>
				{view === "form" ? (
					<SettingsForm scope={scope} projectCwd={projectCwd} />
				) : (
					<ConfigEditor scope={scope} projectCwd={projectCwd} />
				)}
				<TrustSection cwd={projectCwd} />
				<div className="flex items-center gap-2">
					<div className="flex-1" />
					<Button
						variant="outline"
						data-testid="config-scoped-models"
						onClick={() => useUiStore.getState().openDialog("scopedModels")}
					>
						<ListChecks />
						{t("scopedModels.open")}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
