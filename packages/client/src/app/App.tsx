import { useEffect } from "react";
import { ChangelogDialog } from "@/components/dialogs/ChangelogDialog";
import { ConfigDialog } from "@/components/dialogs/ConfigDialog";
import { HotkeysDialog } from "@/components/dialogs/HotkeysDialog";
import { ImportSessionDialog } from "@/components/dialogs/ImportSessionDialog";
import { LoginFlowDialog } from "@/components/dialogs/LoginFlowDialog";
import { NewSessionDialog } from "@/components/dialogs/NewSessionDialog";
import { PackagesDialog } from "@/components/dialogs/PackagesDialog";
import { ProvidersDialog } from "@/components/dialogs/ProvidersDialog";
import { QuickSwitcher } from "@/components/dialogs/QuickSwitcher";
import { ScopedModelsDialog } from "@/components/dialogs/ScopedModelsDialog";
import { Toaster } from "@/components/toasts/Toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { bootstrap } from "@/store/wire";
import { AppShell } from "./AppShell";
import { ThemeProvider } from "./ThemeProvider";

export function App() {
	useEffect(() => bootstrap(), []);
	return (
		<ThemeProvider>
			<TooltipProvider delayDuration={350} skipDelayDuration={200}>
				<AppShell />
				<NewSessionDialog />
				<ImportSessionDialog />
				<QuickSwitcher />
				<ProvidersDialog />
				<LoginFlowDialog />
				<ConfigDialog />
				<PackagesDialog />
				<ScopedModelsDialog />
				<HotkeysDialog />
				<ChangelogDialog />
				<Toaster />
			</TooltipProvider>
		</ThemeProvider>
	);
}
