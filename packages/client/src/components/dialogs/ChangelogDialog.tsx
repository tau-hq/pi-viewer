import { lazy, Suspense, useState } from "react";
import { t } from "@/i18n";
import { useConnectionStore } from "@/store/connection-store";
import { useUiStore } from "@/store/ui-store";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { Spinner } from "../ui/spinner";

const ChangelogBody = lazy(() => import("./ChangelogBody").then((module) => ({ default: module.ChangelogBody })));

/** pi's release notes. The body is a separate chunk, loaded when the dialog is opened. */
export function ChangelogDialog() {
	const open = useUiStore((s) => s.dialog === "changelog");
	const closeDialog = useUiStore((s) => s.closeDialog);
	const hostPiVersion = useConnectionStore((s) => s.host?.piVersion);
	const [version, setVersion] = useState<string | undefined>(undefined);
	const shown = version ?? hostPiVersion;

	return (
		<Dialog open={open} onOpenChange={(next) => !next && closeDialog()}>
			<DialogContent data-testid="changelog-dialog" size="lg">
				<DialogHeader>
					<DialogTitle>{shown ? t("changelog.titleVersion", { version: shown }) : t("changelog.title")}</DialogTitle>
					<DialogDescription>{t("changelog.description")}</DialogDescription>
				</DialogHeader>
				{open && (
					<Suspense
						fallback={
							<div className="flex items-center justify-center gap-2 p-6 text-muted-foreground text-sm">
								<Spinner /> {t("changelog.loading")}
							</div>
						}
					>
						<ChangelogBody onVersion={setVersion} />
					</Suspense>
				)}
			</DialogContent>
		</Dialog>
	);
}
