import { useSessionStore } from "@/store/session-store";
import { useSessionsStore } from "@/store/sessions-store";
import { useUiStore } from "@/store/ui-store";
import { ModelMenu } from "../header/ModelMenu";

export function ModelPicker({ sessionId }: { sessionId: string }) {
	const current = useSessionStore((s) => s.views[sessionId]?.state.model);
	const alive = useSessionStore((s) => s.views[sessionId]?.state.processAlive ?? false);
	const models = useSessionsStore((s) => s.models);
	const command = useSessionsStore((s) => s.command);
	const open = useUiStore((s) => s.dialog === "model");
	const openDialog = useUiStore((s) => s.openDialog);
	const closeDialog = useUiStore((s) => s.closeDialog);
	return (
		<ModelMenu
			models={models}
			current={current}
			disabled={!alive}
			compact
			open={open}
			onOpenChange={(next) => (next ? openDialog("model") : closeDialog())}
			onManageProviders={() => openDialog("providers")}
			onSelect={(model) => {
				if (model)
					void command({ type: "setModel", provider: model.provider, modelId: model.id }).catch(() => undefined);
			}}
		/>
	);
}
